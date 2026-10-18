import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { WebhookService } from '@/src/services/webhook.service'

/** "Enviar teste": a `steel.ping`, sent inline; answers with the delivery. */
export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/webhooks/endpoints/[endpointId]/test',
  handler: ({ userId, params }) =>
    WebhookService.testEndpoint(userId, params.id, params.endpointId),
})
