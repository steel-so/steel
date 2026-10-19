import type { CrmApolloImport } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  APOLLO_BULK_MATCH_SIZE,
  APOLLO_LEAD_SOURCE,
  APOLLO_SOURCE,
  isImportableEmailStatus,
} from '@/src/lib/integrations/apollo'
import {
  ApolloClient,
  type ApolloEnrichedPerson,
} from '@/src/lib/integrations/apollo-client'
import { CrmApolloImportJob } from '@/src/lib/queue/jobs'
import { getCrmApolloImportQueue } from '@/src/lib/queue/queues'
import { ok, type Result } from '@/src/lib/result'
import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmMailingListMemberRepository } from '@/src/repositories/crm-mailing-list.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { ApolloImportContactSchema } from '@/src/schemas/crm-apollo.schema'
import { CrmLeadService } from './crm-lead.service'
import { notifyCrmApolloImportDone } from './crm-notifications'
import { decryptSdIntegrationToken } from './sd-integration-credentials'

/**
 * Worker side of the Apollo import. Walks the picked people in batches of 10,
 * enriches them (`bulk_match`, ~1 credit each — SEARCH only; LIST contacts
 * already carry their e-mail) and feeds `CrmLeadService.intake` in quiet bulk
 * mode. Safe to run again after a pause: `cursor` marks the next person, and
 * a batch that already spent credits is never repeated.
 */

const DEFAULT_PAUSE_MS = 60_000
/** Consecutive failed Apollo calls before the run gives up. */
const MAX_CONSECUTIVE_FAILURES = 3

/** A person normalized from either source (enrichment or saved contact). */
interface ImportCandidate {
  externalId: string
  name: string
  email: string | null
  emailStatus: string | null
  title: string | null
  company: string | null
  city: string | null
  linkedin: string | null
}

type Outcome = 'created' | 'skipped' | 'failed'

export type RunImportOutcome = {
  state: 'DONE' | 'FAILED' | 'PAUSED_RATE_LIMIT' | 'IGNORED'
}

function clip(
  value: string | null | undefined,
  max: number,
): string | undefined {
  const text = value?.trim()
  return text ? text.slice(0, max) : undefined
}

function fromEnriched(person: ApolloEnrichedPerson): ImportCandidate {
  return {
    externalId: person.id,
    name: person.name,
    email: person.email,
    emailStatus: person.emailStatus,
    title: person.title,
    company: person.organizationName,
    city: [person.city, person.state].filter(Boolean).join(', ') || null,
    linkedin: person.linkedinUrl,
  }
}

function fromContacts(raw: unknown): ImportCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const parsed = ApolloImportContactSchema.safeParse(entry)
    if (!parsed.success) return []
    const c = parsed.data
    return [
      {
        externalId: c.id,
        name: c.name,
        email: c.email ?? null,
        emailStatus: c.emailStatus ?? null,
        title: c.title ?? null,
        company: c.organizationName ?? null,
        city: c.city ?? null,
        linkedin: c.linkedinUrl ?? null,
      },
    ]
  })
}

function leadName(candidate: ImportCandidate, email: string): string {
  return clip(candidate.name, 200) ?? email.split('@')[0]
}

async function enqueueRun(importId: string, delayMs: number): Promise<void> {
  await getCrmApolloImportQueue().add(
    CrmApolloImportJob.Run,
    { importId },
    delayMs > 0 ? { delay: delayMs } : undefined,
  )
}

async function finish(
  row: CrmApolloImport,
  status: 'DONE' | 'FAILED',
  error?: string,
): Promise<RunImportOutcome> {
  const updated = await CrmApolloImportRepository.setStatus(row.id, status, {
    error: error ?? null,
    finishedAt: new Date(),
  })
  const final = updated.ok ? updated.value : row
  auditMutation({
    entity: 'crm_apollo_import',
    action: 'update',
    actorId: null,
    targetId: row.id,
    outcome: status === 'DONE' ? 'success' : 'failure',
    reason: error,
    meta: {
      workspaceId: row.workspaceId,
      created: final.createdCount,
      skipped: final.skippedCount,
      failed: final.failedCount,
      credits: final.creditsConsumed,
    },
  })
  if (status === 'DONE') {
    await notifyCrmApolloImportDone({
      workspaceId: row.workspaceId,
      importId: row.id,
      recipientId: row.createdById,
      created: final.createdCount,
      skipped: final.skippedCount,
      failed: final.failedCount,
    })
  }
  return { state: status }
}

export const CrmApolloImportRunner = {
  async run(importId: string): Promise<Result<RunImportOutcome>> {
    const loaded = await CrmApolloImportRepository.findByIdForWorker(importId)
    if (!loaded.ok) return loaded
    const row = loaded.value
    if (row.status === 'DONE' || row.status === 'FAILED') {
      return ok({ state: 'IGNORED' })
    }

    const running = await CrmApolloImportRepository.setStatus(
      row.id,
      'RUNNING',
      { startedAt: row.startedAt ?? new Date(), error: null },
    )
    if (!running.ok) return running

    // Opt-outs are read once: LGPD list of the workspace.
    const optOuts = await CrmEmailOptOutRepository.indexByWorkspace(
      row.workspaceId,
    )
    if (!optOuts.ok) return optOuts

    let key: string | null = null
    let integrationId: string | null = null
    if (row.source === 'SEARCH') {
      const integration = await WorkspaceIntegrationRepository.findByKind(
        row.workspaceId,
        'APOLLO',
      )
      if (!integration.ok) return integration
      const token = integration.value
        ? await decryptSdIntegrationToken(integration.value)
        : null
      if (!integration.value || !token?.ok) {
        return ok(
          await finish(
            row,
            'FAILED',
            'A Apollo foi desconectada durante a importação',
          ),
        )
      }
      key = token.value
      integrationId = integration.value.id
    }

    const contacts = row.source === 'LIST' ? fromContacts(row.contacts) : []
    const total =
      row.source === 'SEARCH' ? row.apolloIds.length : contacts.length
    let cursor = row.cursor
    let consecutiveFailures = 0

    while (cursor < total) {
      const end = Math.min(cursor + APOLLO_BULK_MATCH_SIZE, total)
      let batch: ImportCandidate[]
      let missing = 0
      let credits = 0
      let minuteLeft: number | null = null

      if (row.source === 'SEARCH' && key) {
        const ids = row.apolloIds.slice(cursor, end)
        const matched = await ApolloClient.bulkMatch(key, ids)
        if (!matched.ok) {
          const code = matched.error.code
          if (code === 'CRM_APOLLO_RATE_LIMITED') {
            return ok(await pause(row, matched.error.details))
          }
          if (
            code === 'CRM_APOLLO_INVALID_KEY' ||
            code === 'CRM_APOLLO_FORBIDDEN'
          ) {
            if (integrationId) {
              await WorkspaceIntegrationRepository.markError(
                integrationId,
                matched.error.message,
              )
            }
            return ok(await finish(row, 'FAILED', matched.error.message))
          }
          consecutiveFailures += 1
          await CrmApolloImportRepository.addProgress(row.id, {
            created: 0,
            skipped: 0,
            failed: ids.length,
            credits: 0,
            cursor: end,
          })
          cursor = end
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            return ok(await finish(row, 'FAILED', matched.error.message))
          }
          continue
        }
        consecutiveFailures = 0
        credits = matched.value.data.creditsConsumed
        minuteLeft = matched.value.rateLimit.minuteLeft
        batch = matched.value.data.matches.flatMap((m) =>
          m ? [fromEnriched(m)] : [],
        )
        missing = ids.length - batch.length
      } else {
        batch = contacts.slice(cursor, end)
      }

      const progress = await processBatch(row, batch, optOuts.value.emails)
      await CrmApolloImportRepository.addProgress(row.id, {
        created: progress.created,
        skipped: progress.skipped + missing,
        failed: progress.failed,
        credits,
        cursor: end,
      })
      cursor = end

      // Plan-agnostic throttling: the window is read from the headers.
      if (minuteLeft !== null && minuteLeft <= 0 && cursor < total) {
        return ok(await pause(row, undefined))
      }
    }

    return ok(await finish(row, 'DONE'))
  },
}

/** Marks the run as paused and wakes it after Apollo's `retry-after`. */
async function pause(
  row: CrmApolloImport,
  details: unknown,
): Promise<RunImportOutcome> {
  const seconds =
    details && typeof details === 'object' && 'retryAfterSeconds' in details
      ? Number((details as { retryAfterSeconds: unknown }).retryAfterSeconds)
      : Number.NaN
  const delay =
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PAUSE_MS
  await CrmApolloImportRepository.setStatus(row.id, 'PAUSED_RATE_LIMIT')
  await enqueueRun(row.id, delay)
  logger.info(
    'crm.apollo.import_paused',
    logFields(
      { component: 'CrmApolloImportRunner', workspaceId: row.workspaceId },
      { importId: row.id, delayMs: delay },
    ),
  )
  return { state: 'PAUSED_RATE_LIMIT' }
}

async function processBatch(
  row: CrmApolloImport,
  batch: ImportCandidate[],
  optedOut: Set<string>,
): Promise<{ created: number; skipped: number; failed: number }> {
  const tally = { created: 0, skipped: 0, failed: 0 }
  const known = await CrmLeadRepository.findExistingExternalIds(
    row.workspaceId,
    APOLLO_SOURCE,
    batch.map((c) => c.externalId),
  )
  const alreadyImported = known.ok ? known.value : new Set<string>()
  const listMembers: Array<{ email: string; name?: string }> = []

  for (const candidate of batch) {
    const outcome = await importOne(
      row,
      candidate,
      optedOut,
      alreadyImported,
      listMembers,
    )
    tally[outcome] += 1
  }

  if (row.mailingListId && listMembers.length > 0) {
    const added = await CrmMailingListMemberRepository.addMany(
      row.mailingListId,
      listMembers,
    )
    if (!added.ok) {
      logger.warn(
        'crm.apollo.mailing_list_add_failed',
        logFields(
          { component: 'CrmApolloImportRunner', workspaceId: row.workspaceId },
          { importId: row.id, code: added.error.code },
        ),
      )
    }
  }
  return tally
}

async function importOne(
  row: CrmApolloImport,
  candidate: ImportCandidate,
  optedOut: Set<string>,
  alreadyImported: Set<string>,
  listMembers: Array<{ email: string; name?: string }>,
): Promise<Outcome> {
  const email = candidate.email?.trim().toLowerCase() ?? null
  if (!email || !isImportableEmailStatus(candidate.emailStatus)) {
    return 'skipped'
  }
  if (optedOut.has(email)) return 'skipped'

  const name = leadName(candidate, email)
  // The address is wanted in the list even when the lead already existed.
  listMembers.push({ email, name })
  if (alreadyImported.has(candidate.externalId)) return 'skipped'

  const intake = await CrmLeadService.intake(
    row.workspaceId,
    {
      kind: 'system',
      createdById: row.createdById,
      via: 'apollo',
      refId: row.id,
    },
    {
      name,
      emails: [email],
      company: clip(candidate.company, 200),
      jobTitle: clip(candidate.title, 150),
      city: clip(candidate.city, 100),
      linkedin: clip(candidate.linkedin, 300),
      source: APOLLO_LEAD_SOURCE,
    },
    {
      quiet: true,
      external: { source: APOLLO_SOURCE, id: candidate.externalId },
    },
  )
  if (!intake.ok) {
    logger.warn(
      'crm.apollo.lead_intake_failed',
      logFields(
        { component: 'CrmApolloImportRunner', workspaceId: row.workspaceId },
        { importId: row.id, code: intake.error.code },
      ),
    )
    return 'failed'
  }
  return intake.value.created ? 'created' : 'skipped'
}
