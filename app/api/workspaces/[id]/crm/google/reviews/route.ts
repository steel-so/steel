import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListGoogleReviewsQuerySchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleReviewsService } from '@/src/services/crm-google-reviews.service'

export const GET = sdConfigRoute({
  query: ListGoogleReviewsQuerySchema,
  handler: ({ userId, params, query }) =>
    CrmGoogleReviewsService.list(userId, params.id, query),
})
