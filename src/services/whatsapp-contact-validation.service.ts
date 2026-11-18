import type {
  WhatsAppNumberValidation,
  WhatsAppNumberValidationScope,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  conflict,
  whatsappAiCampaignNotFound,
  whatsappBroadcastNotFound,
  whatsappValidationNotFound,
  whatsappValidationUnavailable,
} from '@/src/errors'
import { WhatsappBroadcastJob } from '@/src/lib/queue/jobs'
import { getWhatsappBroadcastQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  maskPhone,
  NUMBER_CHECK_DEFAULT_TTL_DAYS,
  NUMBER_CHECK_INLINE_MAX,
  NUMBER_CHECK_MAX_CONTACTS,
  needsWhatsappCheck,
} from '@/src/lib/whatsapp/number-check'
import { PLATFORM_VALIDATION_CONNECTION_ID } from '@/src/lib/whatsapp/validation-instance'
import {
  acquirePlatformLease,
  type PlatformLease,
  reservePlatformBudget,
} from '@/src/lib/whatsapp/validation-throttle'
import {
  checkZapiPhonesBatch,
  type ZapiCredentials,
} from '@/src/lib/whatsapp/zapi-client'
import { toWhatsAppNumberValidationDTO } from '@/src/mappers/whatsapp-number-validation.mapper'
import { WhatsAppAiCampaignRepository } from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '@/src/repositories/whatsapp-number-validation.repository'
import type { StartWhatsAppNumberValidationDTO } from '@/src/schemas/whatsapp-number-validation.schema'
import type {
  NumberValidationAvailabilityDTO,
  WhatsAppNumberValidationDTO,
} from '@/types/whatsapp-number-validation'
import { assertModuleMember } from './authz'
import {
  PLATFORM_LINE_UNAVAILABLE_MESSAGE,
  PlatformZapiLineService,
} from './platform-zapi-line.service'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

const PLATFORM_LINE_LOST_MESSAGE =
  'A linha de verificação da plataforma foi desconectada durante a validação. Os números restantes não foram checados; tente de novo depois que um administrador da plataforma reconectar.'

/** Queue attempts of a validation job (exponential backoff from 30 s). */
export const VALIDATION_JOB_ATTEMPTS = 5

export interface InternalValidationInput {
  scope: WhatsAppNumberValidationScope
  scopeId: string | null
  contactIds: string[]
  force?: boolean
}

export type ValidationSourceKind = 'PLATFORM'

export interface ValidationSource {
  kind: ValidationSourceKind
  /** Connection id stored on the run: the platform sentinel. */
  connectionId: string
}

/**
 * THE source of "has WhatsApp?" checks (routes, inline runs and the worker
 * all go through here). Validation is a global feature (ADR 0069): every
 * workspace uses the one platform verification line managed in the admin,
 * whatever connections the workspace has for messaging. When that line is
 * missing or disconnected the check is unavailable.
 */
export async function resolveValidationSource(): Promise<
  Result<ValidationSource>
> {
  const available = await PlatformZapiLineService.isAvailable()
  if (!available.ok) return available
  if (!available.value) {
    return err(whatsappValidationUnavailable(PLATFORM_LINE_UNAVAILABLE_MESSAGE))
  }
  return ok({
    kind: 'PLATFORM',
    connectionId: PLATFORM_VALIDATION_CONNECTION_ID,
  })
}

async function resolveContactIds(
  workspaceId: string,
  dto: StartWhatsAppNumberValidationDTO,
): Promise<Result<{ scopeId: string | null; contactIds: string[] }>> {
  if (dto.scope === 'BROADCAST' && dto.broadcastId) {
    const list = await WhatsAppBroadcastRepository.findByIdRaw(dto.broadcastId)
    if (!list.ok) return list
    if (!list.value || list.value.workspaceId !== workspaceId) {
      return err(whatsappBroadcastNotFound())
    }
    const ids = await WhatsAppBroadcastRepository.listRecipientContactIds(
      dto.broadcastId,
    )
    if (!ids.ok) return ids
    return ok({ scopeId: dto.broadcastId, contactIds: ids.value })
  }
  if (dto.scope === 'AI_CAMPAIGN' && dto.campaignId) {
    const campaign = await WhatsAppAiCampaignRepository.findById(
      dto.campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    if (!campaign.value) return err(whatsappAiCampaignNotFound())
    const ids = await WhatsAppAiCampaignRepository.listRecipientContactIds(
      dto.campaignId,
    )
    if (!ids.ok) return ids
    return ok({ scopeId: dto.campaignId, contactIds: ids.value })
  }
  if (dto.all) {
    const ids = await WhatsAppContactRepository.listIds(
      workspaceId,
      NUMBER_CHECK_MAX_CONTACTS,
    )
    if (!ids.ok) return ids
    return ok({ scopeId: null, contactIds: ids.value })
  }
  return ok({ scopeId: null, contactIds: dto.contactIds ?? [] })
}

export const WhatsAppContactValidationService = {
  /** Starts a check chosen in the UI (contacts, broadcast list or campaign). */
  async start(
    actorId: string,
    workspaceId: string,
    dto: StartWhatsAppNumberValidationDTO,
  ): Promise<Result<WhatsAppNumberValidationDTO>> {
    // Checking rewrites the contacts' cached "tem zap?" state.
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const source = await resolveContactIds(workspaceId, dto)
    if (!source.ok) return source

    return WhatsAppContactValidationService.startInternal(
      actorId,
      workspaceId,
      {
        scope: dto.scope,
        scopeId: source.value.scopeId,
        contactIds: source.value.contactIds,
        force: dto.force,
      },
    )
  },

  /**
   * Creates the run and either executes it inline (small sets) or queues it.
   * Callers have already authorized the actor (the imports do it up front).
   * Plan usage is not consumed: the check sends no message.
   */
  async startInternal(
    actorId: string,
    workspaceId: string,
    input: InternalValidationInput,
  ): Promise<Result<WhatsAppNumberValidationDTO>> {
    const contactIds = Array.from(new Set(input.contactIds))
    if (contactIds.length === 0) {
      return err(conflict('Não há contatos para validar nesta seleção.'))
    }
    if (contactIds.length > NUMBER_CHECK_MAX_CONTACTS) {
      return err(
        conflict(
          `Valide no máximo ${NUMBER_CHECK_MAX_CONTACTS} contatos por vez.`,
        ),
      )
    }

    const source = await resolveValidationSource()
    if (!source.ok) return source

    const active =
      await WhatsAppNumberValidationRepository.findActive(workspaceId)
    if (!active.ok) return active
    if (active.value) {
      return err(
        conflict(
          'Já existe uma validação em andamento. Aguarde terminar para iniciar outra.',
        ),
      )
    }

    const created = await WhatsAppNumberValidationRepository.create({
      workspaceId,
      connectionId: source.value.connectionId,
      requestedById: actorId,
      scope: input.scope,
      scopeId: input.scopeId,
      contactIds,
      force: input.force ?? false,
    })
    if (!created.ok) return created

    const inline = contactIds.length <= NUMBER_CHECK_INLINE_MAX
    auditMutation({
      entity: 'whatsapp_number_validation',
      action: 'start',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        scope: input.scope,
        total: contactIds.length,
        force: input.force ?? false,
        inline,
        source: source.value.kind,
      },
    })

    if (inline) {
      const executed = await WhatsAppContactValidationService.execute(
        created.value.id,
      )
      if (!executed.ok) return executed
      // The shared instance is busy: hand the run to the queue instead.
      if (executed.value.status !== 'deferred') {
        const fresh = await WhatsAppNumberValidationRepository.findById(
          created.value.id,
          workspaceId,
        )
        if (!fresh.ok) return fresh
        return ok(toWhatsAppNumberValidationDTO(fresh.value ?? created.value))
      }
    }

    try {
      await getWhatsappBroadcastQueue().add(
        WhatsappBroadcastJob.ValidateWhatsappNumbers,
        { validationId: created.value.id },
        // Retries are safe: execute() resets the counters when it restarts and
        // already-checked contacts are served from the cache.
        {
          attempts: VALIDATION_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 },
          jobId: `whatsapp-validation-${created.value.id}`,
        },
      )
    } catch (error) {
      logger.error('whatsapp.validation.enqueue_failed', {
        component: 'WhatsAppContactValidationService',
        validationId: created.value.id,
        reason: error instanceof Error ? error.message : 'unknown',
      })
      await WhatsAppNumberValidationRepository.finish(
        created.value.id,
        'FAILED',
        'Não foi possível enfileirar a validação.',
      )
      return err(conflict('Não foi possível iniciar a validação agora.'))
    }
    return ok(toWhatsAppNumberValidationDTO(created.value))
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppNumberValidationDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const run = await WhatsAppNumberValidationRepository.findById(
      id,
      workspaceId,
    )
    if (!run.ok) return run
    if (!run.value) return err(whatsappValidationNotFound())
    return ok(toWhatsAppNumberValidationDTO(run.value))
  },

  /** Whether "tem WhatsApp?" can run now (the platform line is connected). */
  async availability(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NumberValidationAvailabilityDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const available = await PlatformZapiLineService.isAvailable()
    if (!available.ok) return available
    return ok({
      available: available.value,
      source: available.value ? 'PLATFORM' : null,
    })
  },

  /**
   * Runs a check (worker or inline). System flow: no actor. Asks Z-API only
   * for contacts without a fresh result (cache by TTL unless forced), saves
   * every chunk as it arrives and tolerates partial failures: a number the
   * provider could not answer stays "not checked" (failed), never "no
   * WhatsApp". Runs on the platform instance share a Redis lease and a
   * numbers-per-minute budget across all workspaces.
   *
   * `finalAttempt` false lets the queue retry: a busy instance returns
   * `deferred` (nothing touched) and a total provider outage returns `retry`
   * (run left RUNNING, restarted from zero next time).
   */
  async execute(
    validationId: string,
    options: { finalAttempt?: boolean } = {},
  ): Promise<Result<{ status: ExecuteStatus }>> {
    const finalAttempt = options.finalAttempt ?? true
    const found =
      await WhatsAppNumberValidationRepository.findByIdRaw(validationId)
    if (!found.ok) return found
    const run = found.value
    if (!run || (run.status !== 'QUEUED' && run.status !== 'RUNNING')) {
      return ok({ status: 'skipped' })
    }

    // Live check of the platform line before touching anything: when it is
    // gone the run ends "not checked" (no contact is marked).
    const line = await PlatformZapiLineService.acquireForValidation()
    if (!line.ok) {
      if (line.error.code !== 'WHATSAPP_VALIDATION_UNAVAILABLE') return line
      await WhatsAppNumberValidationRepository.finish(
        run.id,
        'FAILED',
        PLATFORM_LINE_UNAVAILABLE_MESSAGE,
      )
      return ok({ status: 'FAILED' })
    }

    const lease = await acquirePlatformLease()
    if (!lease) return ok({ status: 'deferred' })

    try {
      return await runValidation(run, line.value, lease, finalAttempt)
    } finally {
      await lease.release()
    }
  },
}

type ExecuteStatus = 'DONE' | 'FAILED' | 'skipped' | 'deferred' | 'retry'

async function runValidation(
  run: WhatsAppNumberValidation,
  credentials: ZapiCredentials,
  lease: PlatformLease,
  finalAttempt: boolean,
): Promise<Result<{ status: ExecuteStatus }>> {
  // A restarted run (queue retry) recounts from zero; contacts checked in the
  // previous attempt come back as cached.
  if (run.status === 'RUNNING') {
    await WhatsAppNumberValidationRepository.resetProgress(run.id)
  }
  const started = await WhatsAppNumberValidationRepository.markRunning(run.id)
  if (!started.ok) return started

  const settings = await WhatsAppSettingsService.getEffective(run.workspaceId)
  const ttlDays = settings.ok
    ? settings.value.whatsappCheckTtlDays
    : NUMBER_CHECK_DEFAULT_TTL_DAYS

  const contacts = await WhatsAppContactRepository.listForWhatsappCheck(
    run.workspaceId,
    run.contactIds,
  )
  if (!contacts.ok) return contacts

  const now = new Date()
  const stale = contacts.value.filter((contact) =>
    needsWhatsappCheck(contact, { ttlDays, now, force: run.force }),
  )
  const cached = contacts.value.length - stale.length
  // Ids that vanished since the run was created count as processed too.
  const missing = run.contactIds.length - contacts.value.length
  if (cached + missing > 0) {
    await WhatsAppNumberValidationRepository.addProgress(run.id, {
      processed: cached + missing,
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: 0,
      cached,
    })
  }

  // The lookup is keyed by the number exactly as stored (WhatsApp resolves the
  // Brazilian ninth digit on its side) and only hasWhatsapp / LID are saved:
  // the reply never rewrites a contact's waId.
  const byPhone = new Map<string, string>()
  for (const contact of stale) {
    byPhone.set(contact.waId.replace(/\D/g, ''), contact.id)
  }

  let answered = 0
  let lineLost = false
  let chunksStarted = 0
  const batch = await checkZapiPhonesBatch(
    credentials,
    stale.map((contact) => contact.waId),
    {
      beforeChunk: async (size) => {
        await lease.renew()
        // The line was checked when the run started; between chunks the phone
        // may have been unpaired. Once it is gone, every remaining chunk is
        // skipped, i.e. reported "not checked" (never "no WhatsApp").
        if (lineLost) return false
        if (
          chunksStarted > 0 &&
          (await PlatformZapiLineService.isLineLost(credentials))
        ) {
          lineLost = true
          return false
        }
        chunksStarted += 1
        return reservePlatformBudget(size)
      },
      onChunk: async ({ results, failed }) => {
        const checks = results.flatMap((result) => {
          const id = byPhone.get(result.phone)
          return id ? [{ id, hasWhatsapp: result.exists, lid: result.lid }] : []
        })
        const saved = await WhatsAppContactRepository.applyWhatsappChecks(
          run.workspaceId,
          checks,
          new Date(),
        )
        if (!saved.ok) {
          logger.error('whatsapp.validation.save_failed', {
            component: 'WhatsAppContactValidationService',
            validationId: run.id,
            reason: saved.error.code,
          })
        }
        const storedCount = saved.ok ? checks.length : 0
        answered += storedCount
        const withWhatsapp = saved.ok
          ? checks.filter((check) => check.hasWhatsapp).length
          : 0
        await WhatsAppNumberValidationRepository.addProgress(run.id, {
          processed: results.length + failed.length,
          withWhatsapp,
          withoutWhatsapp: storedCount - withWhatsapp,
          failed: failed.length + (results.length - storedCount),
          cached: 0,
        })
      },
    },
  )
  if (batch.invalid.length > 0) {
    logger.warn('whatsapp.validation.invalid_numbers', {
      component: 'WhatsAppContactValidationService',
      validationId: run.id,
      count: batch.invalid.length,
      sample: batch.invalid.slice(0, 3).map(maskPhone),
    })
    await WhatsAppNumberValidationRepository.addProgress(run.id, {
      processed: batch.invalid.length,
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: batch.invalid.length,
      cached: 0,
    })
  }

  const providerDown = stale.length > 0 && answered === 0
  // Total outage with attempts left: leave the run RUNNING for the retry.
  // A lost line is not retried: the admin has to scan the QR again first.
  if (providerDown && !finalAttempt && !lineLost) return ok({ status: 'retry' })

  if (!providerDown) await applyScopeEffects(run)

  await WhatsAppNumberValidationRepository.finish(
    run.id,
    providerDown ? 'FAILED' : 'DONE',
    lineLost
      ? PLATFORM_LINE_LOST_MESSAGE
      : providerDown
        ? 'Não foi possível consultar a Z-API. Tente novamente mais tarde.'
        : null,
  )

  const final = await WhatsAppNumberValidationRepository.findByIdRaw(run.id)
  const totals = final.ok ? final.value : null
  auditMutation({
    entity: 'whatsapp_number_validation',
    action: 'update',
    actorId: run.requestedById,
    targetId: run.id,
    meta: {
      workspaceId: run.workspaceId,
      scope: run.scope,
      status: providerDown ? 'FAILED' : 'DONE',
      source: 'PLATFORM',
      lineLost,
      total: run.contactIds.length,
      withWhatsapp: totals?.withWhatsapp,
      withoutWhatsapp: totals?.withoutWhatsapp,
      failed: totals?.failed,
      cached,
    },
  })

  return ok({ status: providerDown ? 'FAILED' : 'DONE' })
}

/**
 * After a broadcast-list check, a DRAFT list with "pular sem WhatsApp" on
 * marks the recipients found without WhatsApp right away, so the counters show
 * before the send. Queued/running lists are protected at send time instead.
 */
async function applyScopeEffects(run: WhatsAppNumberValidation): Promise<void> {
  if (run.scope !== 'BROADCAST' || !run.scopeId) return
  const list = await WhatsAppBroadcastRepository.findByIdRaw(run.scopeId)
  if (!list.ok || !list.value) return
  if (list.value.status !== 'DRAFT' || !list.value.skipNoWhatsapp) return
  await WhatsAppBroadcastRepository.skipPendingWithoutWhatsapp(run.scopeId)
}
