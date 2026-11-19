import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGoogleReviewsService } from '@/src/services/crm-google-reviews.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleReviewsService.summary(userId, params.id),
})
