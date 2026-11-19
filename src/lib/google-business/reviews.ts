import {
  GOOGLE_NEGATIVE_MAX_STARS,
  type GoogleRatingEvolutionPointDTO,
  type GoogleReviewsSummaryDTO,
} from '@/src/schemas/crm-google-presence.schema'
import type { RawReview } from './client'

/** Pure review helpers: parsing, rollups and the alert rule. */

const STARS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

/** `"FOUR"` → `4`; unknown or missing → `null`. */
export function parseStarRating(value: string | undefined): number | null {
  return value ? (STARS[value] ?? null) : null
}

export type ReviewCacheInput = {
  googleReviewId: string
  reviewerName: string
  reviewerPhotoUrl: string | null
  starRating: number
  comment: string | null
  reviewedAt: Date
  googleUpdatedAt: Date
  replyComment: string | null
  replyUpdatedAt: Date | null
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Google review → cache row. Google appends "(Translated by Google)" blocks
 * to comments written in other languages; the original text comes after
 * "(Original)", which is what the owner should read.
 */
export function toReviewCacheInput(raw: RawReview): ReviewCacheInput | null {
  const id = raw.reviewId ?? raw.name?.split('/').pop()
  const starRating = parseStarRating(raw.starRating)
  const reviewedAt = parseDate(raw.createTime)
  if (!id || starRating === null || !reviewedAt) return null

  const original = raw.comment?.includes('(Original)')
    ? raw.comment.split('(Original)').pop()
    : raw.comment
  const comment = original?.trim() ? original.trim() : null
  const reply = raw.reviewReply?.comment?.trim()

  return {
    googleReviewId: id,
    reviewerName: raw.reviewer?.isAnonymous
      ? 'Usuário do Google'
      : raw.reviewer?.displayName?.trim() || 'Usuário do Google',
    reviewerPhotoUrl: raw.reviewer?.isAnonymous
      ? null
      : (raw.reviewer?.profilePhotoUrl ?? null),
    starRating,
    comment,
    reviewedAt,
    googleUpdatedAt: parseDate(raw.updateTime) ?? reviewedAt,
    replyComment: reply ? reply : null,
    replyUpdatedAt: reply ? parseDate(raw.reviewReply?.updateTime) : null,
  }
}

/** Reviews older than this never trigger an alert (first sync backfills). */
export const ALERT_MAX_AGE_MS = 7 * 86_400_000

/** A new review alerts when it is low-rated, unanswered and recent. */
export function shouldAlertReview(
  review: Pick<ReviewCacheInput, 'starRating' | 'reviewedAt' | 'replyComment'>,
  now: Date = new Date(),
): boolean {
  return (
    review.starRating <= GOOGLE_NEGATIVE_MAX_STARS &&
    !review.replyComment &&
    now.getTime() - review.reviewedAt.getTime() <= ALERT_MAX_AGE_MS
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/**
 * Month-by-month rating for the last `months` months: the month's own
 * average and the cumulative average up to the month's end (the line that
 * answers "are we getting better?").
 */
export function buildEvolution(
  reviews: { starRating: number; reviewedAt: Date }[],
  months = 12,
  now: Date = new Date(),
): GoogleRatingEvolutionPointDTO[] {
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    keys.push(
      monthKey(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)),
      ),
    )
  }
  const firstKey = keys[0]

  let cumulativeSum = 0
  let cumulativeCount = 0
  const perMonth = new Map<string, { sum: number; count: number }>()
  for (const review of reviews) {
    const key = monthKey(review.reviewedAt)
    if (key < firstKey) {
      cumulativeSum += review.starRating
      cumulativeCount += 1
      continue
    }
    const bucket = perMonth.get(key) ?? { sum: 0, count: 0 }
    bucket.sum += review.starRating
    bucket.count += 1
    perMonth.set(key, bucket)
  }

  return keys.map((month) => {
    const bucket = perMonth.get(month)
    if (bucket) {
      cumulativeSum += bucket.sum
      cumulativeCount += bucket.count
    }
    return {
      month,
      count: bucket?.count ?? 0,
      average: bucket ? round2(bucket.sum / bucket.count) : null,
      cumulativeAverage:
        cumulativeCount > 0 ? round2(cumulativeSum / cumulativeCount) : null,
    }
  })
}

export function buildSummary(input: {
  reviews: { starRating: number; reviewedAt: Date; hasReply: boolean }[]
  averageRating: number | null
  totalReviewCount: number | null
  lastSyncAt: Date | null
  now?: Date
}): GoogleReviewsSummaryDTO {
  const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  let replied = 0
  for (const review of input.reviews) {
    const key = String(review.starRating) as keyof typeof distribution
    if (key in distribution) distribution[key] += 1
    if (review.hasReply) replied += 1
  }
  const cachedCount = input.reviews.length
  return {
    averageRating: input.averageRating,
    totalReviewCount: input.totalReviewCount,
    cachedCount,
    distribution,
    repliedCount: replied,
    unrepliedCount: cachedCount - replied,
    responseRate: cachedCount > 0 ? replied / cachedCount : null,
    evolution: buildEvolution(input.reviews, 12, input.now),
    lastSyncAt: input.lastSyncAt?.toISOString() ?? null,
  }
}
