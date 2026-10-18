import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { UpdateWebhookEndpointSchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

export const PATCH = webhookV1Route({
  write: true,
  body: UpdateWebhookEndpointSchema,
  handler: ({ session, params, body }) =>
    WebhookService.updateEndpoint(
      session.userId,
      session.workspaceId,
      params.id,
      body,
      webhookApiContext(session),
    ),
})

export const DELETE = webhookV1Route({
  write: true,
  handler: ({ session, params }) =>
    WebhookService.deleteEndpoint(
      session.userId,
      session.workspaceId,
      params.id,
      webhookApiContext(session),
    ),
})
