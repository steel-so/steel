import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGoogleConnectionService } from '@/src/services/crm-google-connection.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleConnectionService.listLocations(userId, params.id),
})
