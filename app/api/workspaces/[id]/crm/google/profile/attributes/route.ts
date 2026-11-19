import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateGoogleAttributesSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleProfileService.listAttributes(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/crm/google/profile/attributes',
  body: UpdateGoogleAttributesSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleProfileService.updateAttributes(userId, params.id, body),
})
