import { createId } from '@paralleldrive/cuid2'
import type { WebhookDelivery } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { validationError } from '@/src/errors'
import { WebhooksDeliveryJob } from '@/src/lib/queue/jobs'
import { getWebhooksDeliveryQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseWebhookEventData,
  type WebhookEventData,
  type WebhookEventEnvelope,
  type WebhookEventType,
} from '@/src/lib/webhooks/events'
import { publishWebhookEvent } from '@/src/lib/webhooks/realtime'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'

/**
 * Entry point of the outbound webhooks (ADR 0036). `emitWebhookEvent` runs on
 * the request path of the modules and never throws nor waits on the network:
 * it validates `data` against the catalog, publishes the event to the
 * `steel listen` feed, writes one `WebhookDelivery` per subscribed endpoint
 * and enqueues the `deliver` jobs. The worker does the HTTP.
 */

export interface WebhookDispatchOptions {
  /**
   * Explicit target endpoints (test ping, `steel trigger --endpoint`): skips
   * the subscription lookup. Omitted = every active subscribed endpoint.
   */
  endpointIds?: string[]
  /** `false`: the listeners do not get it (the ping goes to one endpoint). */
  broadcast?: boolean
  /** `false`: rows only — the caller sends inline (the test ping). */
  enqueue?: boolean
}

export interface WebhookDispatchResult {
  event: WebhookEventEnvelope
  deliveries: WebhookDelivery[]
}

export function webhookEventId(): string {
  return `evt_${createId()}`
}

/** Enqueues one attempt series; `manual` re-deliveries are one attempt. */
export async function enqueueWebhookDelivery(
  deliveryId: string,
  options: { manual?: boolean; attempt?: number } = {},
): Promise<boolean> {
  try {
    await getWebhooksDeliveryQueue().add(
      WebhooksDeliveryJob.Deliver,
      { deliveryId, ...(options.manual ? { manual: true } : {}) },
      options.manual
        ? { jobId: `${deliveryId}-retry-${options.attempt ?? 0}`, attempts: 1 }
        : { jobId: deliveryId },
    )
    return true
  } catch (cause) {
    logger.warn(
      'webhooks.enqueue_failed',
      logFields(
        { component: 'WebhookEmitter' },
        {
          deliveryId,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    )
    return false
  }
}

export async function dispatchWebhookEvent<T extends WebhookEventType>(
  workspaceId: string,
  type: T,
  data: WebhookEventData<T>,
  options: WebhookDispatchOptions = {},
): Promise<Result<WebhookDispatchResult>> {
  const parsed = parseWebhookEventData(type, data)
  if (!parsed.success) {
    return err(validationError(`Invalid data for webhook event ${type}`))
  }

  const event: WebhookEventEnvelope = {
    id: webhookEventId(),
    type,
    createdAt: new Date().toISOString(),
    workspaceId,
    data: parsed.data,
  }
  const body = JSON.stringify(event)

  if (options.broadcast !== false) {
    await publishWebhookEvent(workspaceId, { id: event.id, type, body })
  }

  let endpointIds = options.endpointIds
  if (!endpointIds) {
    const subscribed = await WebhookEndpointRepository.listSubscribed(
      workspaceId,
      type,
    )
    if (!subscribed.ok) return subscribed
    endpointIds = subscribed.value.map((endpoint) => endpoint.id)
  }

  const created = await WebhookDeliveryRepository.createMany(
    endpointIds.map((endpointId) => ({
      workspaceId,
      endpointId,
      eventId: event.id,
      eventType: type,
      body,
    })),
  )
  if (!created.ok) return created

  if (options.enqueue !== false) {
    for (const delivery of created.value) {
      await enqueueWebhookDelivery(delivery.id)
    }
  }

  if (created.value.length > 0) {
    logger.info(
      'webhooks.event_dispatched',
      logFields(
        { component: 'WebhookEmitter', workspaceId },
        { eventId: event.id, eventType: type, endpoints: created.value.length },
      ),
    )
  }
  return ok({ event, deliveries: created.value })
}

/**
 * Fire-and-forget emission from a business flow: every failure is logged
 * and swallowed, so a webhook problem never fails a CRM save or a ticket.
 */
export async function emitWebhookEvent<T extends WebhookEventType>(
  workspaceId: string,
  type: T,
  /** The data, or a builder run inside the guard (a throw is only logged). */
  data: WebhookEventData<T> | (() => WebhookEventData<T>),
): Promise<void> {
  try {
    const value = typeof data === 'function' ? data() : data
    const result = await dispatchWebhookEvent(workspaceId, type, value)
    if (!result.ok) {
      logger.warn(
        'webhooks.emit_failed',
        logFields(
          { component: 'WebhookEmitter', workspaceId },
          { eventType: type, reason: result.error.code },
        ),
      )
    }
  } catch (cause) {
    logger.warn(
      'webhooks.emit_failed',
      logFields(
        { component: 'WebhookEmitter', workspaceId },
        {
          eventType: type,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    )
  }
}
