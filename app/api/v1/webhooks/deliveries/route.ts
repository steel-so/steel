import { webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { ListWebhookDeliveriesQuerySchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

export const GET = webhookV1Route({
  query: ListWebhookDeliveriesQuerySchema,
  handler: ({ session, query }) =>
    WebhookService.listDeliveries(session.userId, session.workspaceId, query),
})
