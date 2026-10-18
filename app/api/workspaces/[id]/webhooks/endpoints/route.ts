import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateWebhookEndpointSchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

/** Ajustes › Integrações › Webhooks (OWNER/ADMIN, ADR 0036). */

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    WebhookService.listEndpoints(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/webhooks/endpoints',
  body: CreateWebhookEndpointSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    WebhookService.createEndpoint(userId, params.id, body),
})
