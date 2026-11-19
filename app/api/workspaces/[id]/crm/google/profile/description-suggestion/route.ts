import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/crm/google/profile/description-suggestion',
  handler: ({ userId, params }) =>
    CrmGoogleProfileService.suggestDescription(userId, params.id),
})
