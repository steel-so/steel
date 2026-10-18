import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListWebhookDeliveriesQuerySchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

export const GET = sdConfigRoute({
  query: ListWebhookDeliveriesQuerySchema,
  handler: ({ userId, params, query }) =>
    WebhookService.listDeliveries(userId, params.id, query),
})
