import { emitNotification, workspaceAdminIds } from './notification-emitter'

/**
 * In-app notifications of CRM > Presença no Google, fire-and-forget like
 * `crm-notifications.ts`. The workspace admins hear about new low-rated
 * reviews; the dedupe key makes a repeated sync harmless.
 */

export const googleReviewsPath = () => '/crm/google/reviews'

export async function notifyGoogleReviewNegative(input: {
  workspaceId: string
  googleReviewId: string
  starRating: number
  reviewerName: string
  comment: string | null
  locationTitle: string
}): Promise<number> {
  const recipients = await workspaceAdminIds(input.workspaceId)
  const stars =
    input.starRating === 1 ? '1 estrela' : `${input.starRating} estrelas`
  const excerpt = input.comment
    ? ` “${input.comment.length > 140 ? `${input.comment.slice(0, 137)}…` : input.comment}”`
    : ''
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients,
    kind: 'CRM_GOOGLE_REVIEW_NEGATIVE',
    title: `Nova avaliação de ${stars} no Google`,
    body: `${input.reviewerName} avaliou ${input.locationTitle}.${excerpt}`,
    path: googleReviewsPath(),
    dedupeKey: `crm-google-review-negative:${input.googleReviewId}`,
  })
}
