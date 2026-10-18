import type { WebhookDelivery, WebhookEndpoint } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { ok, type Result } from '@/src/lib/result'
import { WEBHOOK_PING_EVENT } from '@/src/lib/webhooks/events'
import { postWebhook } from '@/src/lib/webhooks/http'
import { webhookRequestHeaders } from '@/src/lib/webhooks/signature'
import { checkWebhookUrl } from '@/src/lib/webhooks/url-guard'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'
import { emitNotification, workspaceAdminIds } from './notification-emitter'

/**
 * One attempt of a `WebhookDelivery` (ADR 0036): signs the stored body with
 * the endpoint secret, POSTs it and writes the outcome to the log. Used by
 * the `webhooks-delivery` worker and, inline, by the test ping.
 *
 * Endpoint health: a 2xx resets the auto-disable clock; a failure starts it.
 * An endpoint failing for 3 days in a row is switched off and the workspace
 * admins get an in-app notification. The ping never counts.
 */

export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000
export const WEBHOOK_AUTO_DISABLED_REASON = 'auto'
export const WEBHOOKS_SETTINGS_PATH = '/settings/integrations/webhooks'

/**
 * - `succeeded`: 2xx;
 * - `retry`: failed, the queue tries again;
 * - `failed`: failed for good (last attempt, refused URL, unreadable secret);
 * - `skipped`: not sent (endpoint disabled/removed, row gone).
 */
export type WebhookAttemptOutcome = 'succeeded' | 'retry' | 'failed' | 'skipped'

export interface WebhookAttemptOptions {
  /** No attempts left after this one (the outcome can't be `retry`). */
  finalAttempt: boolean
  /** Manual re-delivery / test: also sent to a disabled endpoint. */
  manual?: boolean
  now?: () => Date
}

export interface WebhookAttemptReport {
  outcome: WebhookAttemptOutcome
  delivery: WebhookDelivery | null
}

function log(
  event: string,
  delivery: Pick<WebhookDelivery, 'id' | 'workspaceId' | 'eventType'>,
  detail: Record<string, unknown> = {},
): void {
  logger.info(
    event,
    logFields(
      { component: 'WebhookDelivery', workspaceId: delivery.workspaceId },
      { deliveryId: delivery.id, eventType: delivery.eventType, ...detail },
    ),
  )
}

async function readSecret(endpoint: WebhookEndpoint): Promise<string | null> {
  try {
    const secret = await decryptConnectionSecret(endpoint.encryptedSecret)
    return secret || null
  } catch {
    return null
  }
}

async function autoDisable(endpoint: WebhookEndpoint, at: Date): Promise<void> {
  const disabled = await WebhookEndpointRepository.disable(
    endpoint.id,
    at,
    WEBHOOK_AUTO_DISABLED_REASON,
  )
  if (!disabled.ok || !disabled.value) return

  auditMutation({
    entity: 'webhook_endpoint',
    action: 'disable',
    actorId: null,
    targetId: endpoint.id,
    reason: 'failing_3_days',
    meta: { workspaceId: endpoint.workspaceId, source: 'system' },
  })
  logger.warn(
    'webhooks.endpoint_auto_disabled',
    logFields(
      { component: 'WebhookDelivery', workspaceId: endpoint.workspaceId },
      {
        endpointId: endpoint.id,
        failingSince: endpoint.failingSince?.toISOString() ?? null,
      },
    ),
  )

  let host = endpoint.url
  try {
    host = new URL(endpoint.url).host
  } catch {
    // keep the raw URL
  }
  await emitNotification({
    workspaceId: endpoint.workspaceId,
    recipients: await workspaceAdminIds(endpoint.workspaceId),
    kind: 'WEBHOOK_ENDPOINT_DISABLED',
    title: `Webhook desativado: ${host}`,
    body: 'O endpoint falhou em todas as entregas dos últimos 3 dias e foi desativado. Corrija o serviço e reative em Ajustes › Integrações › Webhooks.',
    path: WEBHOOKS_SETTINGS_PATH,
    dedupeKey: `webhook-disabled:${endpoint.id}:${at.toISOString().slice(0, 10)}`,
  })
}

async function recordFailure(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
  attempt: {
    status: 'RETRYING' | 'FAILED'
    responseStatus: number | null
    responseBody: string | null
    durationMs: number | null
    error: string
  },
  at: Date,
): Promise<Result<WebhookDelivery>> {
  const recorded = await WebhookDeliveryRepository.recordAttempt(delivery.id, {
    ...attempt,
    at,
  })
  if (!recorded.ok) return recorded

  if (delivery.eventType !== WEBHOOK_PING_EVENT) {
    const marked = await WebhookEndpointRepository.markFailure(endpoint.id, at)
    if (
      marked.ok &&
      marked.value.active &&
      marked.value.failingSince &&
      at.getTime() - marked.value.failingSince.getTime() >=
        WEBHOOK_AUTO_DISABLE_AFTER_MS
    ) {
      await autoDisable(marked.value, at)
    }
  }
  return recorded
}

export async function runWebhookDelivery(
  deliveryId: string,
  options: WebhookAttemptOptions,
): Promise<Result<WebhookAttemptReport>> {
  const now = options.now ?? (() => new Date())
  const found = await WebhookDeliveryRepository.findWithEndpoint(deliveryId)
  if (!found.ok) return found
  if (!found.value) return ok({ outcome: 'skipped', delivery: null })

  const { endpoint, ...delivery } = found.value
  if (endpoint.deletedAt || (!endpoint.active && !options.manual)) {
    const reason = endpoint.deletedAt ? 'endpoint_deleted' : 'endpoint_disabled'
    const skipped = await WebhookDeliveryRepository.markSkipped(
      delivery.id,
      reason,
    )
    if (!skipped.ok) return skipped
    log('webhooks.delivery_skipped', delivery, { reason })
    return ok({ outcome: 'skipped', delivery })
  }

  const secret = await readSecret(endpoint)
  if (!secret) {
    const failed = await recordFailure(
      delivery,
      endpoint,
      {
        status: 'FAILED',
        responseStatus: null,
        responseBody: null,
        durationMs: null,
        error: 'secret_unreadable',
      },
      now(),
    )
    if (!failed.ok) return failed
    return ok({ outcome: 'failed', delivery: failed.value })
  }

  const url = await checkWebhookUrl(endpoint.url)
  if (!url.ok) {
    const failed = await recordFailure(
      delivery,
      endpoint,
      {
        status: 'FAILED',
        responseStatus: null,
        responseBody: null,
        durationMs: null,
        error: `url_not_allowed: ${url.reason}`,
      },
      now(),
    )
    if (!failed.ok) return failed
    log('webhooks.delivery_refused', delivery, { reason: url.reason })
    return ok({ outcome: 'failed', delivery: failed.value })
  }

  const sentAt = now()
  const attempt = await postWebhook({
    url: url.url,
    body: delivery.body,
    headers: webhookRequestHeaders({
      eventId: delivery.eventId,
      secret,
      body: delivery.body,
      timestamp: Math.floor(sentAt.getTime() / 1000),
    }),
  })
  const at = now()

  if (attempt.ok) {
    const recorded = await WebhookDeliveryRepository.recordAttempt(
      delivery.id,
      {
        status: 'SUCCEEDED',
        responseStatus: attempt.status,
        responseBody: attempt.responseBody,
        durationMs: attempt.durationMs,
        error: null,
        at,
      },
    )
    if (!recorded.ok) return recorded
    if (delivery.eventType !== WEBHOOK_PING_EVENT) {
      await WebhookEndpointRepository.markSuccess(endpoint.id, at)
    }
    log('webhooks.delivery_succeeded', delivery, {
      status: attempt.status,
      durationMs: attempt.durationMs,
    })
    return ok({ outcome: 'succeeded', delivery: recorded.value })
  }

  const failed = await recordFailure(
    delivery,
    endpoint,
    {
      status: options.finalAttempt ? 'FAILED' : 'RETRYING',
      responseStatus: attempt.status,
      responseBody: attempt.responseBody,
      durationMs: attempt.durationMs,
      error: attempt.error ?? 'failed',
    },
    at,
  )
  if (!failed.ok) return failed
  log('webhooks.delivery_failed', delivery, {
    status: attempt.status,
    error: attempt.error,
    finalAttempt: options.finalAttempt,
  })
  return ok({
    outcome: options.finalAttempt ? 'failed' : 'retry',
    delivery: failed.value,
  })
}
