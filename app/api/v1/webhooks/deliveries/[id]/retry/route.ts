import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { WebhookService } from '@/src/services/webhook.service'

export const POST = webhookV1Route({
  write: true,
  status: 202,
  handler: ({ session, params }) =>
    WebhookService.retryDelivery(
      session.userId,
      session.workspaceId,
      params.id,
      webhookApiContext(session),
    ),
})
