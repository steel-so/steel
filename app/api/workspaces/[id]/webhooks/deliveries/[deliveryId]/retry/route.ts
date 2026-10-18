import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { WebhookService } from '@/src/services/webhook.service'

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/webhooks/deliveries/[deliveryId]/retry',
  status: 202,
  handler: ({ userId, params }) =>
    WebhookService.retryDelivery(userId, params.id, params.deliveryId),
})
