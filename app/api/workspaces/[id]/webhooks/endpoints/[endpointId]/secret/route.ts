import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { WebhookService } from '@/src/services/webhook.service'

/** Reveal (audited) and rotate the endpoint's signing secret. */

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    WebhookService.revealSecret(userId, params.id, params.endpointId),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/webhooks/endpoints/[endpointId]/secret',
  handler: ({ userId, params }) =>
    WebhookService.rotateSecret(userId, params.id, params.endpointId),
})
