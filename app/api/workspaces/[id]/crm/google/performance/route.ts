import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { GooglePerformanceQuerySchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGooglePerformanceService } from '@/src/services/crm-google-performance.service'

export const GET = sdConfigRoute({
  query: GooglePerformanceQuerySchema,
  handler: ({ userId, params, query }) =>
    CrmGooglePerformanceService.get(userId, params.id, query.range),
})
