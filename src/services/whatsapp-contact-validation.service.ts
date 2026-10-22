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
  NUMBER_CHECK_DEFAULT_TTL_DAYS,
  NUMBER_CHECK_INLINE_MAX,
  NUMBER_CHECK_MAX_CONTACTS,
  needsWhatsappCheck,
} from '@/src/lib/whatsapp/number-check'
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
import type { WhatsAppNumberValidationDTO } from '@/types/whatsapp-number-validation'
import { assertModuleMember } from './authz'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

const NO_ZAPI_CREDENTIALS_MESSAGE =
  'A instância Z-API não está conectada. Reconecte a instância para validar a base.'

export interface InternalValidationInput {
  scope: WhatsAppNumberValidationScope
  scopeId: string | null
  contactIds: string[]
  connectionId?: string
  force?: boolean
}

/**
 * Picks the Z-API connection that answers the check. The check is about the
 * phone number, not the sending connection, so any connected Z-API instance of
 * the workspace works (even when the list/campaign sends through Meta). Meta's
 * Cloud API has no equivalent endpoint and is never called.
 */
async function resolveZapiConnection(
  workspaceId: string,
  preferredId?: string,
): Promise<Result<WhatsAppConnection>> {
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
  if (zapi.length === 0) return err(whatsappValidationUnavailable())

  const connected = zapi.find((connection) => connection.status === 'CONNECTED')
  if (!connected) {
    return err(whatsappValidationUnavailable(NO_ZAPI_CREDENTIALS_MESSAGE))
  }
  return ok(connected)
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

    const connection = await resolveZapiConnection(
      workspaceId,
      input.connectionId,
    )
    if (!connection.ok) return connection

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
      connectionId: connection.value.id,
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
      },
    })

    if (inline) {
      const executed = await WhatsAppContactValidationService.execute(
        created.value.id,
      )
      if (!executed.ok) return executed
      const fresh = await WhatsAppNumberValidationRepository.findById(
        created.value.id,
        workspaceId,
      )
      if (!fresh.ok) return fresh
      return ok(toWhatsAppNumberValidationDTO(fresh.value ?? created.value))
    }

    try {
      await getWhatsappBroadcastQueue().add(
        WhatsappBroadcastJob.ValidateWhatsappNumbers,
        { validationId: created.value.id },
        // One attempt: a retry would count the same contacts twice.
        { attempts: 1, jobId: `whatsapp-validation-${created.value.id}` },
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

  /**
   * Runs a check (worker or inline). System flow: no actor. Asks Z-API only
   * for contacts without a fresh result, saves every chunk as it arrives and
   * tolerates partial failures.
   */
  async execute(
    validationId: string,
  ): Promise<Result<{ status: 'DONE' | 'FAILED' | 'skipped' }>> {
    const found =
      await WhatsAppNumberValidationRepository.findByIdRaw(validationId)
    if (!found.ok) return found
    const run = found.value
    if (!run || (run.status !== 'QUEUED' && run.status !== 'RUNNING')) {
      return ok({ status: 'skipped' })
    }

    const started = await WhatsAppNumberValidationRepository.markRunning(run.id)
    if (!started.ok) return started

    const failRun = async (message: string) => {
      await WhatsAppNumberValidationRepository.finish(run.id, 'FAILED', message)
      return ok({ status: 'FAILED' as const })
    }

    const connection = await WhatsAppConnectionRepository.findById(
      run.connectionId,
      run.workspaceId,
    )
    if (!connection.ok) return connection
    if (connection.value?.provider !== 'ZAPI') {
      return failRun('Conexão Z-API não encontrada.')
    }
    const credentials = await credentialsOf(connection.value)
    if (!credentials) return failRun(NO_ZAPI_CREDENTIALS_MESSAGE)

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

    const byPhone = new Map<string, string>()
    for (const contact of stale) {
      byPhone.set(contact.waId.replace(/\D/g, ''), contact.id)
    }

    let answered = 0
    const batch = await checkZapiPhonesBatch(
      credentials,
      stale.map((contact) => contact.waId),
      {
        onChunk: async ({ results, failed }) => {
          const checks = results.flatMap((result) => {
            const id = byPhone.get(result.phone)
            return id
              ? [{ id, hasWhatsapp: result.exists, lid: result.lid }]
              : []
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
      await WhatsAppNumberValidationRepository.addProgress(run.id, {
        processed: batch.invalid.length,
        withWhatsapp: 0,
        withoutWhatsapp: 0,
        failed: batch.invalid.length,
        cached: 0,
      })
    }

    const providerDown = stale.length > 0 && answered === 0
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
        total: run.contactIds.length,
        withWhatsapp: totals?.withWhatsapp,
        withoutWhatsapp: totals?.withoutWhatsapp,
        failed: totals?.failed,
        cached,
      },
    })

    return ok({ status: providerDown ? 'FAILED' : 'DONE' })
  },
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
