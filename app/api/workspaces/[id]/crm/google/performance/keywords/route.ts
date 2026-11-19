import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGooglePerformanceService } from '@/src/services/crm-google-performance.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGooglePerformanceService.keywords(userId, params.id),
})
