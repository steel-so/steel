import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SelectGoogleLocationSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleConnectionService } from '@/src/services/crm-google-connection.service'

export const PUT = sdConfigRoute({
  consent: 'PUT /api/workspaces/[id]/crm/google/location',
  body: SelectGoogleLocationSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleConnectionService.selectLocation(userId, params.id, body),
})
