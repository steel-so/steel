import { createHmac } from 'node:crypto'
import type { ModuleKind, WebhookEndpoint } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import {
  forbidden,
  webhookDeliveryNotFound,
  webhookEndpointLimitReached,
  webhookEndpointNotFound,
} from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import {
  WEBHOOK_EVENT_EXAMPLES,
  WEBHOOK_EVENTS,
  WEBHOOK_PING_EVENT,
  type WebhookEventType,
  webhookEventDefinition,
  webhookEventModuleKind,
} from '@/src/lib/webhooks/events'
import {
  generateWebhookSecret,
  WEBHOOK_SECRET_PREFIX,
  webhookSecretHint,
} from '@/src/lib/webhooks/signature'
import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'
import {
  toWebhookDeliveryDTO,
  toWebhookEndpointDTO,
  toWebhookEventTypeDTO,
} from '@/src/mappers/webhook.mapper'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'
import {
  type CreateWebhookEndpointDTO,
  type ListWebhookDeliveriesQuery,
  type TriggerWebhookEventDTO,
  type UpdateWebhookEndpointDTO,
  WEBHOOK_ENDPOINT_LIMIT,
} from '@/src/schemas/webhook.schema'
import type {
  WebhookDeliveryDTO,
  WebhookEndpointDTO,
  WebhookEndpointWithSecretDTO,
  WebhookEventTypeDTO,
  WebhookPageDTO,
  WebhookSecretDTO,
  WebhookTriggerResultDTO,
} from '@/types/webhook'
import { assertPrivileged } from './authz'
import { runWebhookDelivery } from './webhook-delivery-runner'
import { dispatchWebhookEvent, enqueueWebhookDelivery } from './webhook-emitter'

/**
 * Outbound webhooks (ADR 0036): endpoints, delivery log, test ping, manual
 * re-delivery, `steel trigger` and the `steel listen` feed. **OWNER/ADMIN
 * only** (`assertPrivileged`), in the app and in the API v1 (where the route
 * also demands `api:write` for changes).
 *
 * The secret is encrypted with `CONNECTION_SECRETS`; it only comes back on
 * create, rotate and the explicit "reveal" (audited). URLs go through the
 * SSRF guard on save and before every attempt.
 */

/** Who is calling: the settings page or a personal token (API v1). */
export interface WebhookCallContext {
  source: 'app' | 'api'
  /** API v1: the token's modules (events of other modules are hidden). */
  modules?: ModuleKind[]
}

const APP: WebhookCallContext = { source: 'app' }

type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'rotate'
  | 'reveal'
  | 'test'
  | 'retry'

function audit(
  action: AuditAction,
  actorId: string,
  workspaceId: string,
  targetId: string,
  ctx: WebhookCallContext,
  extra: {
    outcome?: 'success' | 'failure'
    reason?: string
    meta?: Record<string, unknown>
  } = {},
): void {
  auditMutation({
    entity: action === 'retry' ? 'webhook_delivery' : 'webhook_endpoint',
    action,
    actorId,
    targetId,
    outcome: extra.outcome,
    reason: extra.reason,
    meta: { workspaceId, source: ctx.source, ...(extra.meta ?? {}) },
  })
}

async function requireAdmin(
  actorId: string,
  workspaceId: string,
): Promise<Result<true>> {
  const ctx = await assertPrivileged(actorId, workspaceId)
  if (!ctx.ok) return ctx
  return ok(true)
}

async function guardUrl(url: string): Promise<Result<true>> {
  const checked = await checkWebhookUrl(url)
  return checked.ok ? ok(true) : err(webhookUrlError(checked.reason))
}

async function readSecret(endpoint: WebhookEndpoint): Promise<Result<string>> {
  try {
    return ok(await decryptConnectionSecret(endpoint.encryptedSecret))
  } catch {
    return err(webhookEndpointNotFound())
  }
}

/** Writes the ping delivery row without enqueueing it (sent inline). */
async function createPingDelivery(
  workspaceId: string,
  endpointId: string,
): Promise<Result<string>> {
  const dispatched = await dispatchWebhookEvent(
    workspaceId,
    WEBHOOK_PING_EVENT,
    WEBHOOK_EVENT_EXAMPLES[WEBHOOK_PING_EVENT],
    { endpointIds: [endpointId], broadcast: false, enqueue: false },
  )
  if (!dispatched.ok) return dispatched
  const [delivery] = dispatched.value.deliveries
  if (!delivery) return err(webhookDeliveryNotFound())
  return ok(delivery.id)
}

/**
 * Signing secret of `steel listen` for one member in one workspace: derived
 * from the server secret, so it is stable across sessions (the local app is
 * configured once) and nothing is stored.
 */
export function webhookListenSecret(
  workspaceId: string,
  userId: string,
): string {
  const digest = createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`steel-webhooks-listen:${workspaceId}:${userId}`)
    .digest('base64url')
  return `${WEBHOOK_SECRET_PREFIX}${digest}`
}

/** Event types visible to a call (API v1 tokens are scoped by module). */
export function webhookTypeVisible(
  type: WebhookEventType,
  modules: ModuleKind[] | undefined,
): boolean {
  if (!modules) return true
  const module = webhookEventModuleKind(webhookEventDefinition(type).module)
  return module === null || modules.includes(module)
}

export interface WebhookListenSession {
  secret: string
  /** Types to forward (`[]` = every visible type). */
  events: WebhookEventType[]
  accepts(type: WebhookEventType): boolean
}

export const WebhookService = {
  /** Catalog (any member; the API v1 filters by the token's modules). */
  listEvents(ctx: WebhookCallContext = APP): WebhookEventTypeDTO[] {
    return WEBHOOK_EVENTS.filter((event) =>
      webhookTypeVisible(event.type, ctx.modules),
    ).map(toWebhookEventTypeDTO)
  },

  async listEndpoints(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WebhookPageDTO<WebhookEndpointDTO>>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const rows = await WebhookEndpointRepository.listByWorkspace(workspaceId)
    if (!rows.ok) return rows
    return ok({ items: rows.value.map(toWebhookEndpointDTO), nextCursor: null })
  },

  async createEndpoint(
    actorId: string,
    workspaceId: string,
    dto: CreateWebhookEndpointDTO,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookEndpointWithSecretDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin

    const count = await WebhookEndpointRepository.countByWorkspace(workspaceId)
    if (!count.ok) return count
    if (count.value >= WEBHOOK_ENDPOINT_LIMIT) {
      return err(
        webhookEndpointLimitReached(
          `Este workspace já tem ${WEBHOOK_ENDPOINT_LIMIT} endpoints de webhook. Remova um antes de cadastrar outro.`,
        ),
      )
    }

    const url = await guardUrl(dto.url)
    if (!url.ok) {
      audit('create', actorId, workspaceId, workspaceId, ctx, {
        outcome: 'failure',
        reason: url.error.code,
      })
      return url
    }

    const secret = generateWebhookSecret()
    const created = await WebhookEndpointRepository.create({
      workspaceId,
      url: dto.url,
      description: dto.description?.trim() || null,
      events: dto.events,
      encryptedSecret: await encryptConnectionSecret(secret),
      secretHint: webhookSecretHint(secret),
      active: dto.active ?? true,
      createdById: actorId,
    })
    if (!created.ok) return created

    audit('create', actorId, workspaceId, created.value.id, ctx, {
      meta: { events: dto.events.length },
    })
    return ok({ endpoint: toWebhookEndpointDTO(created.value), secret })
  },

  async updateEndpoint(
    actorId: string,
    workspaceId: string,
    endpointId: string,
    dto: UpdateWebhookEndpointDTO,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookEndpointDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookEndpointRepository.findById(
      endpointId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (dto.url !== undefined && dto.url !== existing.value.url) {
      const url = await guardUrl(dto.url)
      if (!url.ok) return url
    }

    // Re-enabling clears the failure state; switching off records why.
    const activeChange =
      dto.active === undefined || dto.active === existing.value.active
        ? {}
        : dto.active
          ? { disabledAt: null, disabledReason: null, failingSince: null }
          : { disabledAt: new Date(), disabledReason: 'manual' }

    const updated = await WebhookEndpointRepository.update(endpointId, {
      ...(dto.url !== undefined ? { url: dto.url } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
      ...(dto.events !== undefined ? { events: dto.events } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...activeChange,
    })
    if (!updated.ok) return updated

    audit('update', actorId, workspaceId, endpointId, ctx, {
      meta: { fields: Object.keys(dto) },
    })
    return ok(toWebhookEndpointDTO(updated.value))
  },

  async deleteEndpoint(
    actorId: string,
    workspaceId: string,
    endpointId: string,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<{ id: string }>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookEndpointRepository.findById(
      endpointId,
      workspaceId,
    )
    if (!existing.ok) return existing
    const removed = await WebhookEndpointRepository.softDelete(endpointId)
    if (!removed.ok) return removed
    audit('delete', actorId, workspaceId, endpointId, ctx)
    return ok({ id: endpointId })
  },

  async revealSecret(
    actorId: string,
    workspaceId: string,
    endpointId: string,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookSecretDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookEndpointRepository.findById(
      endpointId,
      workspaceId,
    )
    if (!existing.ok) return existing
    const secret = await readSecret(existing.value)
    if (!secret.ok) return secret
    audit('reveal', actorId, workspaceId, endpointId, ctx)
    return ok({ secret: secret.value })
  },

  /** New secret right away: the receiver must switch to it. */
  async rotateSecret(
    actorId: string,
    workspaceId: string,
    endpointId: string,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookEndpointWithSecretDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookEndpointRepository.findById(
      endpointId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const secret = generateWebhookSecret()
    const updated = await WebhookEndpointRepository.update(endpointId, {
      encryptedSecret: await encryptConnectionSecret(secret),
      secretHint: webhookSecretHint(secret),
    })
    if (!updated.ok) return updated
    audit('rotate', actorId, workspaceId, endpointId, ctx)
    return ok({ endpoint: toWebhookEndpointDTO(updated.value), secret })
  },

  /**
   * "Enviar teste": a `steel.ping` to this endpoint only, sent inline (one
   * attempt, also when the endpoint is disabled) so the answer shows up at
   * once. Never counts toward the auto-disable.
   */
  async testEndpoint(
    actorId: string,
    workspaceId: string,
    endpointId: string,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookDeliveryDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookEndpointRepository.findById(
      endpointId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const delivery = await createPingDelivery(workspaceId, endpointId)
    if (!delivery.ok) return delivery
    const run = await runWebhookDelivery(delivery.value, {
      finalAttempt: true,
      manual: true,
    })
    if (!run.ok) return run
    if (!run.value.delivery) return err(webhookDeliveryNotFound())

    audit('test', actorId, workspaceId, endpointId, ctx, {
      outcome: run.value.outcome === 'succeeded' ? 'success' : 'failure',
      reason: run.value.delivery.error ?? undefined,
    })
    return ok(toWebhookDeliveryDTO(run.value.delivery))
  },

  async listDeliveries(
    actorId: string,
    workspaceId: string,
    query: ListWebhookDeliveriesQuery,
  ): Promise<Result<WebhookPageDTO<WebhookDeliveryDTO>>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    if (query.endpointId) {
      const endpoint = await WebhookEndpointRepository.findById(
        query.endpointId,
        workspaceId,
      )
      if (!endpoint.ok) return endpoint
    }
    const page = await WebhookDeliveryRepository.list(workspaceId, query)
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toWebhookDeliveryDTO),
      nextCursor: page.value.nextCursor,
    })
  },

  /** Manual re-delivery: one more attempt, even to a disabled endpoint. */
  async retryDelivery(
    actorId: string,
    workspaceId: string,
    deliveryId: string,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookDeliveryDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const existing = await WebhookDeliveryRepository.findById(
      deliveryId,
      workspaceId,
    )
    if (!existing.ok) return existing
    const endpoint = await WebhookEndpointRepository.findById(
      existing.value.endpointId,
      workspaceId,
    )
    if (!endpoint.ok) return endpoint

    const pending = await WebhookDeliveryRepository.markPending(deliveryId)
    if (!pending.ok) return pending
    await enqueueWebhookDelivery(deliveryId, {
      manual: true,
      attempt: existing.value.attempts,
    })
    audit('retry', actorId, workspaceId, deliveryId, ctx, {
      meta: { endpointId: existing.value.endpointId },
    })
    return ok(toWebhookDeliveryDTO(pending.value))
  },

  /**
   * `steel trigger <type>`: the catalog's sample `data` as a real event of
   * the workspace. Reaches the listeners (`steel listen`) and, with
   * `endpointId`, that endpoint — never the other subscribed endpoints, so a
   * test does not land in a production integration.
   */
  async trigger(
    actorId: string,
    workspaceId: string,
    dto: TriggerWebhookEventDTO,
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookTriggerResultDTO>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    if (!webhookTypeVisible(dto.type, ctx.modules)) {
      return err(forbidden('Este token não tem acesso ao módulo deste evento.'))
    }
    if (dto.endpointId) {
      const endpoint = await WebhookEndpointRepository.findById(
        dto.endpointId,
        workspaceId,
      )
      if (!endpoint.ok) return endpoint
    }

    const dispatched = await dispatchWebhookEvent(
      workspaceId,
      dto.type,
      WEBHOOK_EVENT_EXAMPLES[dto.type],
      { endpointIds: dto.endpointId ? [dto.endpointId] : [] },
    )
    if (!dispatched.ok) return dispatched

    logger.info(
      'webhooks.event_triggered',
      logFields(
        { component: 'WebhookService', workspaceId },
        { eventType: dto.type, source: ctx.source, endpointId: dto.endpointId },
      ),
    )
    return ok({
      event: { id: dispatched.value.event.id, type: dto.type },
      deliveries: dispatched.value.deliveries.length,
    })
  },

  /** `steel listen`: the signing secret and the filter of the feed. */
  async openListen(
    actorId: string,
    workspaceId: string,
    events: WebhookEventType[],
    ctx: WebhookCallContext = APP,
  ): Promise<Result<WebhookListenSession>> {
    const admin = await requireAdmin(actorId, workspaceId)
    if (!admin.ok) return admin
    const wanted = new Set(events)
    return ok({
      secret: webhookListenSecret(workspaceId, actorId),
      events,
      accepts: (type) =>
        type !== WEBHOOK_PING_EVENT &&
        (wanted.size === 0 || wanted.has(type)) &&
        webhookTypeVisible(type, ctx.modules),
    })
  },
}
