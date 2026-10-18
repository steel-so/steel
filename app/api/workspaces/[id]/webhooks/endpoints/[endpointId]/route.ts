import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateWebhookEndpointSchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/webhooks/endpoints/[endpointId]',
  body: UpdateWebhookEndpointSchema,
  handler: ({ userId, params, body }) =>
    WebhookService.updateEndpoint(userId, params.id, params.endpointId, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/webhooks/endpoints/[endpointId]',
  handler: ({ userId, params }) =>
    WebhookService.deleteEndpoint(userId, params.id, params.endpointId),
})
