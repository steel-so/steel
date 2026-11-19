import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateGoogleProfileSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleProfileService.get(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/crm/google/profile',
  body: UpdateGoogleProfileSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleProfileService.update(userId, params.id, body),
})
