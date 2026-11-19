import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleProfileService.getLinks(userId, params.id),
})
