import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateAiActionConnectorSchema } from '@/src/schemas/ai-action.schema'
import { AiActionService } from '@/src/services/ai-action.service'

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/ai/connectors/[connectorId]',
  body: UpdateAiActionConnectorSchema,
  handler: ({ userId, params, body }) =>
    AiActionService.update(userId, params.id, params.connectorId, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/ai/connectors/[connectorId]',
  handler: ({ userId, params }) =>
    AiActionService.remove(userId, params.id, params.connectorId),
})
