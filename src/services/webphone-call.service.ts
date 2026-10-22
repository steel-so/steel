import { randomBytes } from 'node:crypto'
import type { WhatsAppPhoneCall, WhatsAppPhoneCallStatus } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  forbidden,
  pabxExtensionRequired,
  phoneCallNotFound,
} from '@/src/errors'
import { toPabxDestination } from '@/src/lib/pabx/destination'
import { phoneMatchKey } from '@/src/lib/pabx/recording'
import { err, ok, type Result } from '@/src/lib/result'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppPhoneCallDTO } from '@/src/mappers/whatsapp-phone-call.mapper'
import { toWhatsAppSettingsDTO } from '@/src/mappers/whatsapp-settings.mapper'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import type {
  WebphoneCallBeginDTO,
  WebphoneCallReportDTO,
} from '@/src/schemas/webphone-call.schema'
import type {
  WebphoneCallTrackingDTO,
  WhatsAppPhoneCallDTO,
} from '@/types/whatsapp-phone-call'
import { assertModuleMember } from './authz'
import { PhoneCallLinkService } from './phone-call-link.service'
import { loadConversationForViewer } from './whatsapp-conversation-scope.service'
import { callbackUrl, hashToken } from './whatsapp-phone-call.service'

const FINAL_STATUSES: ReadonlySet<WhatsAppPhoneCallStatus> = new Set([
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'CANCELED',
  'EXTENSION_NO_ANSWER',
  'FAILED',
])

/** A ring the PABX started this long ago can still be the call the browser sees. */
export const ADOPT_WINDOW_MS = 5 * 60 * 1000

/** Outcome of a call the browser saw end unanswered → call status. */
const UNANSWERED_STATUS: Record<
  NonNullable<WebphoneCallReportDTO['outcome']>,
  WhatsAppPhoneCallStatus
> = {
  completed: 'COMPLETED',
  busy: 'BUSY',
  missed: 'NO_ANSWER',
  declined: 'CANCELED',
  canceled: 'CANCELED',
  failed: 'FAILED',
}

async function publishCall(call: WhatsAppPhoneCall): Promise<void> {
  await publishWhatsAppEvent(call.workspaceId, {
    type: 'phone-call.updated',
    call: toWhatsAppPhoneCallDTO(call),
  })
}

/** Same remote party: equal phone key, or equal digits when it has none. */
function samePhone(a: string, b: string): boolean {
  const keyA = phoneMatchKey(a)
  const keyB = phoneMatchKey(b)
  if (keyA && keyB) return keyA === keyB
  return a.replace(/\D/g, '') === b.replace(/\D/g, '')
}

/** The row this browser call already has, from the PABX flow. */
async function findExisting(
  workspaceId: string,
  extension: string,
  input: WebphoneCallBeginDTO,
  now: Date,
): Promise<Result<WhatsAppPhoneCall | null>> {
  if (input.pabxUniqueId) {
    const byId = await WhatsAppPhoneCallRepository.findByPabxUniqueId(
      workspaceId,
      input.pabxUniqueId,
    )
    if (!byId.ok) return byId
    if (byId.value) return ok(byId.value)
  }
  // Only a ring that reaches the browser can be a click-to-call row: an
  // outbound browser call never has one.
  if (input.direction !== 'in') return ok(null)
  const live = await WhatsAppPhoneCallRepository.listLiveByExtension(
    workspaceId,
    extension,
    new Date(now.getTime() - ADOPT_WINDOW_MS),
  )
  if (!live.ok) return live
  return ok(
    live.value.find(
      (call) =>
        call.source === 'CLICK_TO_CALL' &&
        samePhone(call.destination, input.number),
    ) ?? null,
  )
}

/** Fills the ticket/CRM links of a call the PABX closed first. */
async function backfillLinks(
  call: WhatsAppPhoneCall,
): Promise<Result<WhatsAppPhoneCallDTO>> {
  if (call.sdTicketId || call.crmPersonId || call.crmOpportunityId)
    return ok(toWhatsAppPhoneCallDTO(call))
  const links = await PhoneCallLinkService.resolve(call)
  if (!links.sdTicketId && !links.crmPersonId)
    return ok(toWhatsAppPhoneCallDTO(call))
  const updated = await WhatsAppPhoneCallRepository.update(call.id, links)
  if (!updated.ok) return updated
  await publishCall(updated.value)
  return ok(toWhatsAppPhoneCallDTO(updated.value))
}

/**
 * Calls placed or answered in the browser phone (ADR 0044 addendum). The
 * phone reports each step; the row is a `WhatsAppPhoneCall` like a
 * click-to-call one, so history, recording, transcription and the record
 * timelines (ADR 0043) treat both alike.
 */
export const WebphoneCallService = {
  /**
   * Starts tracking a call. Idempotent against the PABX flow: a row with
   * the same PABX unique id, or a click-to-call ring of the same extension
   * to the same number in the last minutes (the extension the browser
   * answers), is reused instead of creating a second one.
   */
  async begin(
    actorId: string,
    workspaceId: string,
    input: WebphoneCallBeginDTO,
    now = new Date(),
  ): Promise<Result<WebphoneCallTrackingDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const actor = await UserRepository.findById(actorId)
    if (!actor.ok) return actor
    const { pabxExtension, pabxDeviceId, pabxWebphoneEnabled } = actor.value
    if (!pabxExtension || !pabxDeviceId) return err(pabxExtensionRequired())
    if (!pabxWebphoneEnabled) return err(forbidden())

    const existing = await findExisting(workspaceId, pabxExtension, input, now)
    if (!existing.ok) return existing
    if (existing.value) {
      const adopted = existing.value
      let row = adopted
      if (input.pabxUniqueId && !adopted.pabxUniqueId) {
        const updated = await WhatsAppPhoneCallRepository.update(adopted.id, {
          pabxUniqueId: input.pabxUniqueId,
        })
        if (!updated.ok) return updated
        row = updated.value
      }
      return ok({
        call: toWhatsAppPhoneCallDTO(row),
        callbackToken: null,
        callbackUrl: callbackUrl(),
        record: false,
        adopted: true,
      })
    }

    let conversationId: string | null = null
    if (input.conversationId) {
      const visible = await loadConversationForViewer(
        { userId: actorId, role: membership.value.role },
        workspaceId,
        input.conversationId,
      )
      if (!visible.ok) return visible
      conversationId = input.conversationId
    } else {
      conversationId = await PhoneCallLinkService.findConversationId(
        workspaceId,
        input.number,
      )
    }

    const settingsRow =
      await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!settingsRow.ok) return settingsRow
    const settings = toWhatsAppSettingsDTO(workspaceId, settingsRow.value)
    // The PABX records outbound browser calls when the INVITE carries the
    // callback headers; an inbound call has no token to hand it.
    const outbound = input.direction === 'out'
    const record = outbound && settings.callRecordingEnabled

    const callbackToken = randomBytes(24).toString('base64url')
    const destination =
      toPabxDestination(input.number) || input.number.slice(0, 20)
    const created = await WhatsAppPhoneCallRepository.create({
      workspaceId,
      conversationId,
      userId: actorId,
      deviceId: pabxDeviceId,
      extension: pabxExtension,
      destination: destination.slice(0, 20),
      callbackTokenHash: hashToken(callbackToken),
      direction: outbound ? 'OUTBOUND' : 'INBOUND',
      source: 'WEBPHONE',
      status: outbound ? 'DIALING' : 'QUEUED',
      pabxUniqueId: input.pabxUniqueId ?? null,
      remoteName: input.name || null,
      recordingRequested: record,
      recordingNotice: record ? settings.callRecordingNotice : null,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        conversationId,
        deviceId: pabxDeviceId,
        source: 'WEBPHONE',
        direction: created.value.direction,
        recordingRequested: record,
      },
    })
    logger.info('webphone call started', {
      workspaceId,
      callId: created.value.id,
      direction: created.value.direction,
      linkedConversation: Boolean(conversationId),
    })
    await publishCall(created.value)
    return ok({
      call: toWhatsAppPhoneCallDTO(created.value),
      callbackToken: outbound ? callbackToken : null,
      callbackUrl: callbackUrl(),
      record,
      adopted: false,
    })
  },

  /**
   * One step of a tracked call: the user answered, or it ended. Only the
   * user who owns the call may report it. A call the PABX already closed
   * stays as it is (first final report wins) — the record links are still
   * filled in.
   */
  async report(
    actorId: string,
    workspaceId: string,
    callId: string,
    input: WebphoneCallReportDTO,
    now = new Date(),
  ): Promise<Result<WhatsAppPhoneCallDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const found = await WhatsAppPhoneCallRepository.findById(callId)
    if (!found.ok) return found
    const call = found.value
    if (!call || call.workspaceId !== workspaceId || call.userId !== actorId)
      return err(phoneCallNotFound())

    if (FINAL_STATUSES.has(call.status)) {
      return backfillLinks(call)
    }

    if (input.event === 'answered') {
      if (call.status === 'IN_PROGRESS') return ok(toWhatsAppPhoneCallDTO(call))
      const answered = await WhatsAppPhoneCallRepository.update(call.id, {
        status: 'IN_PROGRESS',
        answeredAt: now,
      })
      if (!answered.ok) return answered
      await publishCall(answered.value)
      return ok(toWhatsAppPhoneCallDTO(answered.value))
    }

    const wasAnswered =
      Boolean(call.answeredAt) || input.outcome === 'completed'
    const answeredAt = wasAnswered ? (call.answeredAt ?? now) : null
    const status: WhatsAppPhoneCallStatus = wasAnswered
      ? 'COMPLETED'
      : UNANSWERED_STATUS[input.outcome ?? 'failed']
    const links = await PhoneCallLinkService.resolve(call)
    const ended = await WhatsAppPhoneCallRepository.update(call.id, {
      status,
      endedAt: now,
      answeredAt,
      durationSeconds: answeredAt
        ? Math.max(0, Math.round((now.getTime() - answeredAt.getTime()) / 1000))
        : null,
      ...links,
    })
    if (!ended.ok) return ended

    logger.info('webphone call ended', {
      workspaceId,
      callId: call.id,
      status,
      durationSeconds: ended.value.durationSeconds,
    })
    await publishCall(ended.value)
    return ok(toWhatsAppPhoneCallDTO(ended.value))
  },
}
