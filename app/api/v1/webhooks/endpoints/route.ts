import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { CreateWebhookEndpointSchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

export const GET = webhookV1Route({
  handler: ({ session }) =>
    WebhookService.listEndpoints(session.userId, session.workspaceId),
})

export const POST = webhookV1Route({
  write: true,
  body: CreateWebhookEndpointSchema,
  status: 201,
  handler: ({ session, body }) =>
    WebhookService.createEndpoint(
      session.userId,
      session.workspaceId,
      body,
      webhookApiContext(session),
    ),
})
