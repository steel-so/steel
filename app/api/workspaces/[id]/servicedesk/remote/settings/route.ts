import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdRemoteSettingsSchema } from '@/src/schemas/sd-remote.schema'
import { SdRemoteService } from '@/src/services/sd-remote.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdRemoteService.getSettings(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/remote/settings',
  body: UpdateSdRemoteSettingsSchema,
  handler: ({ userId, params, body }) =>
    SdRemoteService.updateSettings(userId, params.id, body),
})
