import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateGoogleSettingsSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleConnectionService } from '@/src/services/crm-google-connection.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleConnectionService.get(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/crm/google/connection',
  body: UpdateGoogleSettingsSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleConnectionService.updateSettings(userId, params.id, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/crm/google/connection',
  handler: ({ userId, params }) =>
    CrmGoogleConnectionService.disconnect(userId, params.id),
})
