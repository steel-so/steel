import { randomBytes } from 'node:crypto'
import type {
  Prisma,
  WhatsAppEcomTriggerKind,
  WhatsAppStoreIntegration,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  unauthorized,
  whatsappConnectionNotFound,
  whatsappEcomTriggerInvalid,
  whatsappStoreInvalid,
  whatsappStoreNotFound,
  whatsappTemplateNotFound,
} from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import {
  type NormalizedStoreEvent,
  normalizeStoreEvent,
  renderStoreVariable,
} from '@/src/lib/ecommerce/normalize'
import {
  STORE_EVENT_HEADER,
  verifyStoreSignature,
} from '@/src/lib/ecommerce/signature'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toWhatsAppEcomEventDTO,
  toWhatsAppEcomTriggerDTO,
  toWhatsAppStoreIntegrationDTO,
} from '@/src/mappers/whatsapp-commerce.mapper'
import { WhatsAppCommerceSettingsRepository } from '@/src/repositories/whatsapp-catalog.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import {
  type EcomEventWithStore,
  WhatsAppEcomEventRepository,
  WhatsAppEcomTriggerRepository,
  WhatsAppStoreIntegrationRepository,
} from '@/src/repositories/whatsapp-store.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import {
  type CreateWhatsAppStoreDTO,
  ECOM_TRIGGER_KINDS,
  type UpdateWhatsAppStoreDTO,
  type UpsertEcomTriggerDTO,
} from '@/src/schemas/whatsapp-commerce.schema'
import type {
  WhatsAppEcomEventDTO,
  WhatsAppEcomTriggerDTO,
  WhatsAppStoreIntegrationDTO,
  WhatsAppStoreIntegrationSecretDTO,
} from '@/types/whatsapp-commerce'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { sendAutomationTemplate } from './whatsapp-automation-send.service'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
/** An event that still cannot be sent after this long is given up. */
const GIVE_UP_AFTER_MS = 24 * HOUR_MS
const RETRY_MS = 15 * MINUTE_MS
/** A claim older than this was dropped by a crashed worker. */
const STALE_CLAIM_MS = 10 * MINUTE_MS
const CLAIM_BATCH = 50

const TRIGGER_OF_EVENT: Partial<
  Record<NormalizedStoreEvent['kind'], WhatsAppEcomTriggerKind>
> = {
  CART_ABANDONED: 'ABANDONED_CART',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  ORDER_DELIVERED: 'POST_PURCHASE',
}

export interface EcomTickResult {
  claimed: number
  sent: number
  skipped: number
  failed: number
  rescheduled: number
}

function newSecret(): string {
  return randomBytes(24).toString('hex')
}

async function encryptCredentials(
  accessToken: string | null | undefined,
  storeId: string | null | undefined,
): Promise<string | null> {
  if (!accessToken) return null
  return encryptConnectionSecret(
    JSON.stringify({ accessToken, ...(storeId ? { storeId } : {}) }),
  )
}

async function requireConnection(
  workspaceId: string,
  connectionId: string,
): Promise<Result<void>> {
  const connection = await WhatsAppConnectionRepository.findById(
    connectionId,
    workspaceId,
  )
  if (!connection.ok) return connection
  if (connection.value?.module !== 'COMMUNICATION') {
    return err(whatsappConnectionNotFound())
  }
  return ok(undefined)
}

async function loadOwned(
  workspaceId: string,
  storeId: string,
): Promise<Result<WhatsAppStoreIntegration>> {
  const found = await WhatsAppStoreIntegrationRepository.findById(
    storeId,
    workspaceId,
  )
  if (!found.ok) return found
  if (!found.value) return err(whatsappStoreNotFound())
  return ok(found.value)
}

export const WhatsAppStoreService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppStoreIntegrationDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const rows = await WhatsAppStoreIntegrationRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppStoreIntegrationDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppStoreDTO,
  ): Promise<Result<WhatsAppStoreIntegrationSecretDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const connection = await requireConnection(workspaceId, dto.connectionId)
    if (!connection.ok) return connection
    if (dto.provider === 'NUVEMSHOP' && dto.accessToken && !dto.storeId) {
      return err(whatsappStoreInvalid('Informe o id da loja na Nuvemshop'))
    }

    const secret = newSecret()
    const created = await WhatsAppStoreIntegrationRepository.create({
      workspaceId,
      provider: dto.provider,
      name: dto.name,
      connectionId: dto.connectionId,
      storeUrl: dto.storeUrl ?? null,
      encryptedWebhookSecret: await encryptConnectionSecret(secret),
      encryptedCredentials: await encryptCredentials(
        dto.accessToken,
        dto.storeId,
      ),
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_store_integration',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, provider: dto.provider },
    })
    return ok({
      ...toWhatsAppStoreIntegrationDTO(created.value),
      webhookSecret: secret,
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    storeId: string,
    dto: UpdateWhatsAppStoreDTO,
  ): Promise<Result<WhatsAppStoreIntegrationDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const store = await loadOwned(workspaceId, storeId)
    if (!store.ok) return store
    if (dto.connectionId) {
      const connection = await requireConnection(workspaceId, dto.connectionId)
      if (!connection.ok) return connection
    }

    const data: Prisma.WhatsAppStoreIntegrationUncheckedUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.connectionId !== undefined) data.connectionId = dto.connectionId
    if (dto.enabled !== undefined) data.enabled = dto.enabled
    if (dto.storeUrl !== undefined) data.storeUrl = dto.storeUrl
    if (dto.accessToken !== undefined) {
      data.encryptedCredentials = await encryptCredentials(
        dto.accessToken,
        dto.storeId,
      )
    }
    const updated = await WhatsAppStoreIntegrationRepository.update(
      storeId,
      data,
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_store_integration',
      action: 'update',
      actorId,
      targetId: storeId,
      meta: {
        workspaceId,
        fields: Object.keys(dto).filter((key) => key !== 'accessToken'),
        credentialsChanged: dto.accessToken !== undefined,
      },
    })
    return ok(toWhatsAppStoreIntegrationDTO(updated.value))
  },

  /** New signing secret; the old one stops working at once. */
  async rotateSecret(
    actorId: string,
    workspaceId: string,
    storeId: string,
  ): Promise<Result<WhatsAppStoreIntegrationSecretDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const store = await loadOwned(workspaceId, storeId)
    if (!store.ok) return store

    const secret = newSecret()
    const updated = await WhatsAppStoreIntegrationRepository.update(storeId, {
      encryptedWebhookSecret: await encryptConnectionSecret(secret),
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_store_integration',
      action: 'update',
      actorId,
      targetId: storeId,
      meta: { workspaceId, rotatedSecret: true },
    })
    return ok({
      ...toWhatsAppStoreIntegrationDTO(updated.value),
      webhookSecret: secret,
    })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    storeId: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const store = await loadOwned(workspaceId, storeId)
    if (!store.ok) return store
    const deleted = await WhatsAppStoreIntegrationRepository.delete(storeId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_store_integration',
      action: 'delete',
      actorId,
      targetId: storeId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  async listTriggers(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppEcomTriggerDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const rows = await WhatsAppEcomTriggerRepository.list(workspaceId)
    if (!rows.ok) return rows
    const byKind = new Map(rows.value.map((row) => [row.kind, row]))
    return ok(
      ECOM_TRIGGER_KINDS.map((kind) =>
        toWhatsAppEcomTriggerDTO(kind, byKind.get(kind) ?? null),
      ),
    )
  },

  async upsertTrigger(
    actorId: string,
    workspaceId: string,
    kind: WhatsAppEcomTriggerKind,
    dto: UpsertEcomTriggerDTO,
  ): Promise<Result<WhatsAppEcomTriggerDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    if (dto.enabled && !dto.templateId) {
      return err(
        whatsappEcomTriggerInvalid(
          'Escolha o template antes de ativar o gatilho',
        ),
      )
    }
    if (dto.templateId) {
      const template = await WhatsAppTemplateRepository.findById(
        dto.templateId,
        workspaceId,
      )
      if (!template.ok) return template
      if (!template.value) return err(whatsappTemplateNotFound())
      if (dto.enabled && template.value.status !== 'APPROVED') {
        return err(
          whatsappEcomTriggerInvalid(
            'Só templates aprovados pela Meta podem ser usados em um gatilho',
          ),
        )
      }
    }
    const saved = await WhatsAppEcomTriggerRepository.upsert(
      workspaceId,
      kind,
      {
        enabled: dto.enabled,
        templateId: dto.templateId,
        delayMinutes: dto.delayMinutes,
        variables: dto.variables,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'whatsapp_ecom_trigger',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, kind, enabled: dto.enabled },
    })
    return ok(toWhatsAppEcomTriggerDTO(kind, saved.value))
  },

  async listEvents(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppEcomEventDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const rows = await WhatsAppEcomEventRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppEcomEventDTO))
  },

  /**
   * A store webhook. Public: the call authenticates with the HMAC of the raw
   * body made with the store's own secret. Unknown stores and bad signatures
   * answer the same 401, so the endpoint reveals nothing about which ids
   * exist. Everything after that is a 200 (the store must not retry).
   */
  async receiveWebhook(
    integrationId: string,
    headers: Headers,
    rawBody: string,
    now: Date = new Date(),
  ): Promise<Result<{ accepted: boolean; reason?: string }>> {
    const found =
      await WhatsAppStoreIntegrationRepository.findById(integrationId)
    if (!found.ok) return found
    if (!found.value) return err(unauthorized())
    const store = found.value

    const secret = await decryptConnectionSecret(store.encryptedWebhookSecret)
    if (!verifyStoreSignature(headers, rawBody, secret)) {
      return err(unauthorized())
    }
    if (!store.enabled) return ok({ accepted: false, reason: 'Loja desligada' })

    const settings = await WhatsAppCommerceSettingsRepository.findByWorkspace(
      store.workspaceId,
    )
    if (!settings.ok) return settings
    if (!settings.value?.triggersEnabled) {
      return ok({ accepted: false, reason: 'Gatilhos desligados' })
    }

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return ok({ accepted: false, reason: 'Corpo não é JSON' })
    }
    const normalized = normalizeStoreEvent(
      store.provider,
      body,
      headers.get(STORE_EVENT_HEADER),
    )
    if (!normalized.ok) {
      return ok({ accepted: false, reason: normalized.reason })
    }
    const event = normalized.event
    await WhatsAppStoreIntegrationRepository.touch(store.id, now)

    // A purchase makes the pending abandoned-cart message pointless.
    if (event.kind === 'ORDER_CREATED') {
      const cancelled = await WhatsAppEcomEventRepository.skipPending(
        store.workspaceId,
        event.waId,
        'CART_ABANDONED',
        'O cliente concluiu a compra',
        now,
      )
      if (!cancelled.ok) return cancelled
    }

    const triggerKind = TRIGGER_OF_EVENT[event.kind]
    const trigger = triggerKind
      ? await WhatsAppEcomTriggerRepository.findByKind(
          store.workspaceId,
          triggerKind,
        )
      : null
    if (trigger && !trigger.ok) return trigger
    const active = trigger?.value?.enabled && trigger.value.templateId
    const stored = await WhatsAppEcomEventRepository.createIfNew({
      workspaceId: store.workspaceId,
      integrationId: store.id,
      kind: event.kind,
      externalId: event.externalId,
      waId: event.waId,
      contactName: event.name,
      data: event as unknown as Prisma.InputJsonValue,
      status: active ? 'PENDING' : 'SKIPPED',
      skipReason: active
        ? null
        : event.kind === 'ORDER_CREATED'
          ? 'Compra registrada'
          : 'Sem gatilho ativo para este evento',
      scheduledAt: new Date(
        now.getTime() + (trigger?.value?.delayMinutes ?? 0) * MINUTE_MS,
      ),
      processedAt: active ? null : now,
    })
    if (!stored.ok) return stored
    return ok({ accepted: stored.value !== null })
  },

  /** Worker tick: sends the store events whose time has come. */
  async tick(now: Date = new Date()): Promise<Result<EcomTickResult>> {
    const claimed = await WhatsAppEcomEventRepository.claimDue(
      now,
      new Date(now.getTime() - STALE_CLAIM_MS),
      CLAIM_BATCH,
    )
    if (!claimed.ok) return claimed
    const tally: EcomTickResult = {
      claimed: claimed.value.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      rescheduled: 0,
    }

    for (const event of claimed.value) {
      const outcome = await processEvent(event, now)
      tally[outcome] += 1
    }
    return ok(tally)
  },
}

type Outcome = 'sent' | 'skipped' | 'failed' | 'rescheduled'

async function processEvent(
  event: EcomEventWithStore,
  now: Date,
): Promise<Outcome> {
  const skip = async (reason: string): Promise<Outcome> => {
    await WhatsAppEcomEventRepository.finish(
      event.id,
      'SKIPPED',
      { skipReason: reason },
      now,
    )
    return 'skipped'
  }
  const fail = async (reason: string): Promise<Outcome> => {
    await WhatsAppEcomEventRepository.finish(
      event.id,
      'FAILED',
      { skipReason: reason },
      now,
    )
    return 'failed'
  }
  const retry = async (reason: string): Promise<Outcome> => {
    if (now.getTime() - event.scheduledAt.getTime() > GIVE_UP_AFTER_MS) {
      return fail(reason)
    }
    await WhatsAppEcomEventRepository.reschedule(
      event.id,
      new Date(now.getTime() + RETRY_MS),
    )
    return 'rescheduled'
  }

  const settings = await WhatsAppCommerceSettingsRepository.findByWorkspace(
    event.workspaceId,
  )
  if (!settings.ok) return retry(settings.error.code)
  if (!settings.value?.triggersEnabled || !event.integration.enabled) {
    return skip('Gatilhos desligados')
  }

  const triggerKind = TRIGGER_OF_EVENT[event.kind]
  const trigger = triggerKind
    ? await WhatsAppEcomTriggerRepository.findByKind(
        event.workspaceId,
        triggerKind,
      )
    : null
  if (!trigger?.ok)
    return trigger ? retry(trigger.error.code) : skip('Sem gatilho')
  if (!trigger.value?.enabled || !trigger.value.templateId) {
    return skip('Gatilho desligado')
  }

  if (settings.value.throttleHours > 0) {
    const recent = await WhatsAppEcomEventRepository.hasSentSince(
      event.workspaceId,
      event.waId,
      new Date(now.getTime() - settings.value.throttleHours * HOUR_MS),
    )
    if (!recent.ok) return retry(recent.error.code)
    if (recent.value) return skip('Limite de frequência por cliente')
  }

  const data = event.data as unknown as NormalizedStoreEvent
  const tokens = Array.isArray(trigger.value.variables)
    ? trigger.value.variables.filter((v): v is string => typeof v === 'string')
    : []
  const sent = await sendAutomationTemplate({
    workspaceId: event.workspaceId,
    connectionId: event.integration.connectionId,
    templateId: trigger.value.templateId,
    waId: event.waId,
    contactName: event.contactName,
    variables: tokens.map((token) => renderStoreVariable(token, data)),
  })
  if (!sent.ok) {
    if (sent.error.code === 'RATE_LIMITED') return retry(sent.error.message)
    logger.warn('whatsapp.ecom.send_failed', {
      workspaceId: event.workspaceId,
      eventId: event.id,
      reason: sent.error.code,
    })
    return fail(sent.error.message)
  }
  if (sent.value.kind === 'opted_out') {
    return skip('O contato pediu para não receber mensagens')
  }
  if (sent.value.kind === 'not_ready') return retry(sent.value.reason)

  await WhatsAppEcomEventRepository.finish(
    event.id,
    'SENT',
    { providerMessageId: sent.value.providerMessageId },
    now,
  )
  return 'sent'
}
