import type {
  WhatsAppConnection,
  WhatsAppNumberValidation,
  WhatsAppNumberValidationScope,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  conflict,
  whatsappAiCampaignNotFound,
  whatsappBroadcastNotFound,
  whatsappConnectionNotFound,
  whatsappValidationNotFound,
  whatsappValidationUnavailable,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
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
import {
  getPlatformZapiCredentials,
  PLATFORM_VALIDATION_CONNECTION_ID,
} from '@/src/lib/whatsapp/validation-instance'
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
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '@/src/repositories/whatsapp-number-validation.repository'
import type { StartWhatsAppNumberValidationDTO } from '@/src/schemas/whatsapp-number-validation.schema'
import type {
  NumberValidationAvailabilityDTO,
  WhatsAppNumberValidationDTO,
} from '@/types/whatsapp-number-validation'
import { assertModuleMember } from './authz'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

const NO_ZAPI_CREDENTIALS_MESSAGE =
  'A instância Z-API não está conectada e a validação padrão da plataforma não está disponível. Reconecte a instância para validar a base.'

/** Queue attempts of a validation job (exponential backoff from 30 s). */
export const VALIDATION_JOB_ATTEMPTS = 5

export interface InternalValidationInput {
  scope: WhatsAppNumberValidationScope
  scopeId: string | null
  contactIds: string[]
  connectionId?: string
  force?: boolean
}

export type ValidationSourceKind = 'WORKSPACE' | 'PLATFORM'

export interface ValidationSource {
  kind: ValidationSourceKind
  /** Connection id stored on the run; the platform sentinel for PLATFORM. */
  connectionId: string
}

/**
 * THE connection selection rule for "has WhatsApp?" checks (routes, inline
 * runs and the worker all go through here). The check is about the phone
 * number, not the sending connection, so a Meta-only workspace works too:
 *
 *   1. the workspace's own CONNECTED Z-API connection wins (no load on the
 *      shared instance);
 *   2. otherwise the platform instance (ZAPI_VALIDATION_*), when configured;
 *   3. otherwise validation is unavailable (error says so).
 *
 * An explicit `preferredId` forces rule 1 for that connection: it must be a
 * connected Z-API connection of the workspace, there is no silent fallback.
 * Meta's Cloud API has no such endpoint and is never called.
 */
export async function resolveValidationSource(
  workspaceId: string,
  preferredId?: string,
): Promise<Result<ValidationSource>> {
  const connections =
    await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
  if (!connections.ok) return connections

  if (preferredId) {
    const preferred = connections.value.find((c) => c.id === preferredId)
    if (!preferred) return err(whatsappConnectionNotFound())
    if (preferred.provider !== 'ZAPI')
      return err(whatsappValidationUnavailable())
  }

  const zapi = connections.value.filter(
    (connection) =>
      connection.provider === 'ZAPI' &&
      connection.zapiInstanceId &&
      connection.encryptedZapiToken &&
      (!preferredId || connection.id === preferredId),
  )
  const connected = zapi.find((connection) => connection.status === 'CONNECTED')
  if (connected) {
    return ok({ kind: 'WORKSPACE', connectionId: connected.id })
  }

  if (!preferredId && getPlatformZapiCredentials()) {
    return ok({
      kind: 'PLATFORM',
      connectionId: PLATFORM_VALIDATION_CONNECTION_ID,
    })
  }

  if (zapi.length > 0) {
    return err(whatsappValidationUnavailable(NO_ZAPI_CREDENTIALS_MESSAGE))
  }
  return err(whatsappValidationUnavailable())
}

async function credentialsOf(
  connection: WhatsAppConnection,
): Promise<ZapiCredentials | null> {
  if (!connection.zapiInstanceId || !connection.encryptedZapiToken) return null
  return {
    instanceId: connection.zapiInstanceId,
    token: await decryptConnectionSecret(connection.encryptedZapiToken),
    clientToken: connection.encryptedZapiClientToken
      ? await decryptConnectionSecret(connection.encryptedZapiClientToken)
      : undefined,
  }
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
        connectionId: dto.connectionId,
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

    const source = await resolveValidationSource(
      workspaceId,
      input.connectionId,
    )
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

  /** Whether "tem WhatsApp?" can run for this workspace, and through what. */
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

    const source = await resolveValidationSource(workspaceId)
    if (!source.ok) {
      // Only "unavailable" is an answer; a database failure is an error.
      if (source.error.code === 'WHATSAPP_VALIDATION_UNAVAILABLE') {
        return ok({ available: false, source: null })
      }
      return source
    }
    return ok({ available: true, source: source.value.kind })
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

    let credentials: ZapiCredentials | null = null
    let lease: PlatformLease | null = null

    if (run.connectionId === PLATFORM_VALIDATION_CONNECTION_ID) {
      credentials = getPlatformZapiCredentials()
      if (!credentials) {
        await WhatsAppNumberValidationRepository.finish(
          run.id,
          'FAILED',
          'A validação de números não está disponível no momento.',
        )
        return ok({ status: 'FAILED' })
      }
      lease = await acquirePlatformLease()
      if (!lease) return ok({ status: 'deferred' })
    }

    try {
      return await runValidation(run, credentials, lease, finalAttempt)
    } finally {
      await lease?.release()
    }
  },
}

type ExecuteStatus = 'DONE' | 'FAILED' | 'skipped' | 'deferred' | 'retry'

async function runValidation(
  run: WhatsAppNumberValidation,
  platformCredentials: ZapiCredentials | null,
  lease: PlatformLease | null,
  finalAttempt: boolean,
): Promise<Result<{ status: ExecuteStatus }>> {
  // A restarted run (queue retry) recounts from zero; contacts checked in the
  // previous attempt come back as cached.
  if (run.status === 'RUNNING') {
    await WhatsAppNumberValidationRepository.resetProgress(run.id)
  }
  const started = await WhatsAppNumberValidationRepository.markRunning(run.id)
  if (!started.ok) return started

  const failRun = async (message: string) => {
    await WhatsAppNumberValidationRepository.finish(run.id, 'FAILED', message)
    return ok({ status: 'FAILED' as const })
  }

  let credentials = platformCredentials
  if (!credentials) {
    const connection = await WhatsAppConnectionRepository.findById(
      run.connectionId,
      run.workspaceId,
    )
    if (!connection.ok) return connection
    if (connection.value?.provider !== 'ZAPI') {
      return failRun('Conexão Z-API não encontrada.')
    }
    credentials = await credentialsOf(connection.value)
    if (!credentials) return failRun(NO_ZAPI_CREDENTIALS_MESSAGE)
  }

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
  const batch = await checkZapiPhonesBatch(
    credentials,
    stale.map((contact) => contact.waId),
    {
      beforeChunk: lease
        ? async (size) => {
            await lease.renew()
            return reservePlatformBudget(size)
          }
        : undefined,
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
  if (providerDown && !finalAttempt) return ok({ status: 'retry' })

  if (!providerDown) await applyScopeEffects(run)

  await WhatsAppNumberValidationRepository.finish(
    run.id,
    providerDown ? 'FAILED' : 'DONE',
    providerDown
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
      source:
        run.connectionId === PLATFORM_VALIDATION_CONNECTION_ID
          ? 'PLATFORM'
          : 'WORKSPACE',
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
