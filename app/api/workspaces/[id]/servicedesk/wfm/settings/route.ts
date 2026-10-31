import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdWfmSettingsSchema } from '@/src/schemas/sd-wfm.schema'
import { SdWfmService } from '@/src/services/sd-wfm.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) => SdWfmService.getSettings(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/wfm/settings',
  body: UpdateSdWfmSettingsSchema,
  handler: ({ userId, params, body }) =>
    SdWfmService.updateSettings(userId, params.id, body),
})
