import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ReplyGoogleReviewSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleReviewsService } from '@/src/services/crm-google-reviews.service'

export const PUT = sdConfigRoute({
  consent: 'PUT /api/workspaces/[id]/crm/google/reviews/[reviewId]/reply',
  body: ReplyGoogleReviewSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleReviewsService.reply(
      userId,
      params.id,
      params.reviewId,
      body.comment,
    ),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/crm/google/reviews/[reviewId]/reply',
  handler: ({ userId, params }) =>
    CrmGoogleReviewsService.deleteReply(userId, params.id, params.reviewId),
})
