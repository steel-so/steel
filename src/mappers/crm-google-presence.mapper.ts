import type {
  CrmGoogleBusinessConnection,
  CrmGoogleReview,
} from '@prisma/client'
import type {
  CrmGoogleConnectionDTO,
  GoogleReviewDTO,
} from '@/src/schemas/crm-google-presence.schema'

/**
 * Connection → DTO. Tokens never leave the server: the DTO carries only what
 * the screens show (account e-mail, chosen location, sync state).
 */
export function toCrmGoogleConnectionDTO(
  connection: CrmGoogleBusinessConnection | null,
  configured: boolean,
): CrmGoogleConnectionDTO {
  if (!connection) {
    return {
      configured,
      connected: false,
      status: null,
      googleEmail: null,
      location: null,
      replyTone: null,
      averageRating: null,
      totalReviewCount: null,
      lastReviewsSyncAt: null,
      lastMetricsSyncAt: null,
      lastSyncError: null,
    }
  }
  return {
    configured,
    connected: connection.status === 'CONNECTED',
    status: connection.status,
    googleEmail: connection.googleEmail,
    location:
      connection.accountName && connection.locationName
        ? {
            accountName: connection.accountName,
            locationName: connection.locationName,
            title: connection.locationTitle ?? 'Local do Google',
            placeId: connection.placeId,
            mapsUri: connection.mapsUri,
            newReviewUri: connection.newReviewUri,
          }
        : null,
    replyTone: connection.replyTone,
    averageRating: connection.averageRating,
    totalReviewCount: connection.totalReviewCount,
    lastReviewsSyncAt: connection.lastReviewsSyncAt?.toISOString() ?? null,
    lastMetricsSyncAt: connection.lastMetricsSyncAt?.toISOString() ?? null,
    lastSyncError: connection.lastSyncError,
  }
}

export function toGoogleReviewDTO(review: CrmGoogleReview): GoogleReviewDTO {
  return {
    id: review.googleReviewId,
    reviewerName: review.reviewerName,
    reviewerPhotoUrl: review.reviewerPhotoUrl,
    starRating: review.starRating,
    comment: review.comment,
    reviewedAt: review.reviewedAt.toISOString(),
    reply: review.replyComment
      ? {
          comment: review.replyComment,
          updatedAt: review.replyUpdatedAt?.toISOString() ?? null,
        }
      : null,
  }
}
