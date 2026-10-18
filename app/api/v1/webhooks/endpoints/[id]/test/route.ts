import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { WebhookService } from '@/src/services/webhook.service'

export const POST = webhookV1Route({
  write: true,
  handler: ({ session, params }) =>
    WebhookService.testEndpoint(
      session.userId,
      session.workspaceId,
      params.id,
      webhookApiContext(session),
    ),
})
