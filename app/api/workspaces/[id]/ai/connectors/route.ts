import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateAiActionConnectorSchema } from '@/src/schemas/ai-action.schema'
import { AiActionService } from '@/src/services/ai-action.service'

/** Ajustes › IA › Ações: HTTP connectors the AI may call (OWNER/ADMIN). */

export const GET = sdConfigRoute({
  handler: ({ userId, params }) => AiActionService.list(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/ai/connectors',
  body: CreateAiActionConnectorSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    AiActionService.create(userId, params.id, body),
})
