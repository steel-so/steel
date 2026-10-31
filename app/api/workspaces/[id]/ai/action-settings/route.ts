import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateAiActionSettingsSchema } from '@/src/schemas/ai-action.schema'
import { AiActionService } from '@/src/services/ai-action.service'

/** Master switch and WhatsApp auto-reply allow-list of the AI actions. */
export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/ai/action-settings',
  body: UpdateAiActionSettingsSchema,
  handler: ({ userId, params, body }) =>
    AiActionService.updateSettings(userId, params.id, body),
})
