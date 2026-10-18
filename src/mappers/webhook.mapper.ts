import type { WebhookDelivery, WebhookEndpoint } from '@prisma/client'
import type { WebhookEventDefinition } from '@/src/lib/webhooks/events'
import { WEBHOOK_SECRET_PREFIX } from '@/src/lib/webhooks/signature'
import type {
  WebhookDeliveryDTO,
  WebhookEndpointDTO,
  WebhookEventTypeDTO,
} from '@/types/webhook'

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null

export function toWebhookEventTypeDTO(
  event: WebhookEventDefinition,
): WebhookEventTypeDTO {
  return {
    type: event.type,
    module: event.module,
    description: event.description,
    subscribable: event.subscribable,
  }
}

export function toWebhookEndpointDTO(
  endpoint: WebhookEndpoint,
): WebhookEndpointDTO {
  return {
    id: endpoint.id,
    workspaceId: endpoint.workspaceId,
    url: endpoint.url,
    description: endpoint.description,
    events: endpoint.events,
    active: endpoint.active,
    secretHint: `${WEBHOOK_SECRET_PREFIX}…${endpoint.secretHint}`,
    disabledAt: iso(endpoint.disabledAt),
    disabledReason: endpoint.disabledReason,
    failingSince: iso(endpoint.failingSince),
    lastSuccessAt: iso(endpoint.lastSuccessAt),
    lastFailureAt: iso(endpoint.lastFailureAt),
    createdById: endpoint.createdById,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  }
}

export function toWebhookDeliveryDTO(
  delivery: WebhookDelivery,
): WebhookDeliveryDTO {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    responseStatus: delivery.responseStatus,
    responseBody: delivery.responseBody,
    durationMs: delivery.durationMs,
    error: delivery.error,
    requestBody: delivery.body,
    lastAttemptAt: iso(delivery.lastAttemptAt),
    deliveredAt: iso(delivery.deliveredAt),
    createdAt: delivery.createdAt.toISOString(),
  }
}
