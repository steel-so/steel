import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmGoogleReviewsService } from '@/src/services/crm-google-reviews.service'

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/crm/google/reviews/sync',
  handler: ({ userId, params }) =>
    CrmGoogleReviewsService.sync(userId, params.id),
})
