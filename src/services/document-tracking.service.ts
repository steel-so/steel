import { createHmac } from 'node:crypto'
import type { DocumentEventType } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { DocumentAnalyticsCache } from '@/src/cache/document-analytics.cache'
import { sendDocumentViewedEmail } from '@/src/lib/mail/crm/send-document-viewed'
import { ok, type Result } from '@/src/lib/result'
import {
  type DocumentEventInput,
  type DocumentTrackContext,
  DocumentTrackRepository,
} from '@/src/repositories/document-track.repository'
import {
  DocumentSettingsSchema,
  type DocumentTrackInput,
} from '@/src/schemas/document.schema'
import { assertModuleEnabled } from './authz'
import { resolveDocumentToken } from './document-track-token'
import { emitNotification } from './notification-emitter'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'

/**
 * Beacons of the public link `/d/<token>` (ADR 0063). A beacon opens the
 * reading session on its first arrival (OPENED, first/last view, SENT →
 * VIEWED, FORWARDED, the owner's "abriu agora" notification) and otherwise
 * only adds counters to the Redis buffer, which the `documents-analytics`
 * worker moves to Postgres every minute (`flush`). Clicks, plays and
 * downloads are stored as events, capped per session.
 *
 * The visitor never sees an error caused by the side effects: they are
 * logged and the beacon still succeeds. LGPD: the IP is stored only as an
 * HMAC; the referrer only as its host.
 */

export interface DocumentTrackMeta {
  ip: string
  userAgent: string | null
  now?: Date
}

export interface DocumentFlushResult {
  sessions: number
  sections: number
  /** Another flush held the lock. */
  skipped: boolean
}

const VIEW_BUCKET_MS = 30 * 60_000

const EVENT_TYPES: Record<
  DocumentTrackInput['events'][number]['type'],
  DocumentEventType
> = {
  link_clicked: 'LINK_CLICKED',
  video_played: 'VIDEO_PLAYED',
  attachment_downloaded: 'ATTACHMENT_DOWNLOADED',
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'computador',
  tablet: 'tablet',
  mobile: 'celular',
}

/** HMAC of the IP with the server secret (never stored raw). */
export function hashDocumentIp(ip: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`documents:${ip}`)
    .digest('hex')
}

/** Host of the referrer URL, or `null` (no path or query is stored). */
export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).host || null
  } catch {
    return null
  }
}

function logFailure(event: string, documentId: string, reason: string) {
  logger.warn(event, {
    component: 'DocumentTrackingService',
    documentId,
    reason,
  })
}

interface OpenedSession {
  documentId: string
  workspaceId: string
  recipientId: string | null
  sessionId: string
  visitorId: string
  device: string | null
  referrer: string | null
  now: Date
}

/** Who opened it, for the notification title and body (pt-BR). */
export function describeReader(input: {
  context: DocumentTrackContext
  forwarded: boolean
  device: string | null
}): { title: string; body: string } {
  const { document, recipient } = input.context
  const name = !recipient
    ? 'Um visitante'
    : input.forwarded
      ? `Alguém com o link de ${recipient.name}`
      : recipient.name
  const reason = !recipient
    ? 'Leitura pelo link público do documento.'
    : input.forwarded
      ? 'O link pessoal foi aberto em outro navegador e pode ter sido encaminhado.'
      : recipient.firstViewedAt
        ? 'Voltou a ler o documento.'
        : 'Primeira leitura do documento.'
  const device = input.device ? DEVICE_LABELS[input.device] : undefined
  return {
    title: `${name} abriu ${document.title} agora`,
    body: device ? `${reason} No ${device}.` : reason,
  }
}

async function notifyOwner(
  session: OpenedSession,
  context: DocumentTrackContext,
  forwarded: boolean,
): Promise<void> {
  const reader = !session.recipientId
    ? `visitor:${session.visitorId}`
    : forwarded
      ? `forward:${session.visitorId}`
      : `recipient:${session.recipientId}`
  const claimed = await DocumentAnalyticsCache.claimViewNotification(
    session.documentId,
    reader,
  )
  if (!claimed) return

  const { title, body } = describeReader({
    context,
    forwarded,
    device: session.device,
  })
  const { document } = context
  const bucket = Math.floor(session.now.getTime() / VIEW_BUCKET_MS)
  await emitNotification({
    workspaceId: session.workspaceId,
    recipients: [document.ownerId],
    kind: 'CRM_DOCUMENT_VIEWED',
    title,
    body,
    path: `/crm/documents/${document.id}`,
    dedupeKey: `document-viewed:${document.id}:${reader}:${bucket}`,
  })

  const settings = DocumentSettingsSchema.partial().safeParse(document.settings)
  const notifyByEmail = settings.success
    ? settings.data.notifyOnView !== false
    : true
  if (!notifyByEmail) return
  try {
    await sendDocumentViewedEmail({
      email: document.owner.email,
      username: document.owner.name,
      title,
      detail: body,
      documentTitle: document.title,
      workspaceName: document.workspace.name,
      documentUrl: `${baseEmailUrl}/${document.workspace.slug}/crm/documents/${document.id}`,
    })
  } catch (error) {
    logFailure(
      'documents.track.view_email_failed',
      document.id,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/** Side effects of a new session; failures are logged, never returned. */
async function onSessionOpened(session: OpenedSession): Promise<void> {
  const context = await DocumentTrackRepository.findContext(
    session.documentId,
    session.recipientId,
  )
  if (!context.ok) {
    logFailure('documents.track.context_failed', session.documentId, 'db')
  }

  const viewed = await DocumentTrackRepository.markViewed({
    documentId: session.documentId,
    recipientId: session.recipientId,
    at: session.now,
  })
  if (!viewed.ok) {
    logFailure('documents.track.mark_viewed_failed', session.documentId, 'db')
  }

  let forwarded = false
  if (session.recipientId) {
    const history = await DocumentTrackRepository.visitorHistory({
      recipientId: session.recipientId,
      visitorId: session.visitorId,
      sessionId: session.sessionId,
    })
    if (
      history.ok &&
      !history.value.sameVisitor &&
      history.value.otherVisitor
    ) {
      forwarded = await DocumentAnalyticsCache.claimForward(
        session.recipientId,
        session.visitorId,
      )
    }
  }

  const base = {
    documentId: session.documentId,
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    recipientId: session.recipientId,
  }
  const events: DocumentEventInput[] = [
    {
      ...base,
      type: 'OPENED',
      data: {
        device: session.device,
        referrer: session.referrer,
        visitorId: session.visitorId,
      },
    },
  ]
  if (forwarded) {
    events.push({
      ...base,
      type: 'FORWARDED',
      data: { visitorId: session.visitorId },
    })
  }
  const recorded = await DocumentTrackRepository.createEvents(events)
  if (!recorded.ok) {
    logFailure('documents.track.open_events_failed', session.documentId, 'db')
  }

  if (context.ok && context.value) {
    await notifyOwner(session, context.value, forwarded)
    await dispatchFirstProposalView(context.value)
  }
}

/**
 * Steel Agents: the first view ever of a proposal fires
 * `crm.proposal.viewed`, as the legacy proposals did (same payload keys,
 * plus `documentId`). Claimed in Redis so racing first sessions fire once.
 */
async function dispatchFirstProposalView(
  context: DocumentTrackContext,
): Promise<void> {
  const { document } = context
  if (document.kind !== 'PROPOSAL' || document.firstViewedAt) return
  const claimed = await DocumentAnalyticsCache.claimViewNotification(
    document.id,
    'agent:first-view',
  )
  if (!claimed) return
  await dispatchSteelAgentEvent(document.workspaceId, 'crm.proposal.viewed', {
    proposalId: document.id,
    documentId: document.id,
    name: document.title,
    responsibleId: document.ownerId,
  })
}

async function recordBeaconEvents(input: {
  documentId: string
  workspaceId: string
  recipientId: string | null
  sessionId: string
  events: DocumentTrackInput['events']
}): Promise<void> {
  if (input.events.length === 0) return
  const allowed = await DocumentAnalyticsCache.reserveEvents(
    input.sessionId,
    input.events.length,
  )
  if (allowed === 0) return
  const accepted = input.events.slice(0, allowed)
  const rows: DocumentEventInput[] = accepted.map((event) => ({
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    recipientId: input.recipientId,
    type: EVENT_TYPES[event.type],
    data: {
      ...(event.target ? { target: event.target } : {}),
      ...(event.sectionId ? { sectionId: event.sectionId } : {}),
    },
  }))
  const created = await DocumentTrackRepository.createEvents(rows)
  if (!created.ok) {
    logFailure('documents.track.events_failed', input.documentId, 'db')
  }
}

export const DocumentTrackingService = {
  /** Records one beacon of the public link. */
  async track(
    token: string,
    input: DocumentTrackInput,
    meta: DocumentTrackMeta,
  ): Promise<Result<{ sessionId: string }>> {
    const link = await resolveDocumentToken(token)
    if (!link.ok) return link
    const { documentId, workspaceId, recipientId, versionId } = link.value
    const now = meta.now ?? new Date()

    let sessionId = await DocumentAnalyticsCache.getSessionId(
      documentId,
      input.sessionKey,
    )
    if (!sessionId) {
      // Public route: no session, but the CRM must still be on.
      const enabled = await assertModuleEnabled(workspaceId, 'CRM')
      if (!enabled.ok) return enabled

      const device = input.device ?? null
      const referrer = referrerHost(input.referrer)
      const opened = await DocumentTrackRepository.openSession({
        documentId,
        workspaceId,
        versionId,
        recipientId,
        sessionKey: input.sessionKey,
        visitorId: input.visitorId,
        ipHash: hashDocumentIp(meta.ip),
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        device,
        referrer,
        at: now,
      })
      if (!opened.ok) return opened
      sessionId = opened.value.id
      await DocumentAnalyticsCache.rememberSession(
        documentId,
        input.sessionKey,
        sessionId,
      )
      if (opened.value.created) {
        await onSessionOpened({
          documentId,
          workspaceId,
          recipientId,
          sessionId,
          visitorId: input.visitorId,
          device,
          referrer,
          now,
        })
      }
    }

    const buffered = await DocumentAnalyticsCache.bufferRead({
      sessionId,
      activeMs: input.activeMs,
      sections: input.sections,
      entered: input.entered,
      scrollPct: input.scrollPct,
      reachedEnd: input.reachedEnd,
      seenAt: now,
    })
    if (!buffered) {
      logFailure('documents.track.buffer_failed', documentId, 'redis')
    }

    await recordBeaconEvents({
      documentId,
      workspaceId,
      recipientId,
      sessionId,
      events: input.events,
    })

    return ok({ sessionId })
  },

  /**
   * Moves the Redis buffer to Postgres (worker, every minute). A failed
   * write keeps the batch for the retry; it is dropped only after commit.
   */
  async flush(now: Date = new Date()): Promise<Result<DocumentFlushResult>> {
    const taken = await DocumentAnalyticsCache.takeBatch()
    if (!taken.ok) return taken
    if (!taken.value) return ok({ sessions: 0, sections: 0, skipped: true })

    const applied = await DocumentTrackRepository.applyReadBatch(
      taken.value,
      now,
    )
    if (!applied.ok) {
      await DocumentAnalyticsCache.releaseBatch()
      return applied
    }

    const acked = await DocumentAnalyticsCache.ackBatch()
    if (!acked.ok) {
      // Committed but not dropped: logged loudly, the next run would apply
      // it again. Redis failing right after a successful read is rare.
      logger.error('documents.analytics.ack_failed', {
        component: 'DocumentTrackingService',
        sessions: applied.value.sessions,
      })
    }
    return ok({ ...applied.value, skipped: false })
  },
}
