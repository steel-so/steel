import { describe, expect, it } from 'vitest'
import {
  ALERT_MAX_AGE_MS,
  buildEvolution,
  buildSummary,
  parseStarRating,
  shouldAlertReview,
  toReviewCacheInput,
} from '@/src/lib/google-business/reviews'

const NOW = new Date('2026-11-19T12:00:00Z')

describe('parseStarRating', () => {
  it('maps Google enum names to numbers', () => {
    expect(parseStarRating('ONE')).toBe(1)
    expect(parseStarRating('FIVE')).toBe(5)
  })

  it('returns null for unspecified or missing ratings', () => {
    expect(parseStarRating('STAR_RATING_UNSPECIFIED')).toBeNull()
    expect(parseStarRating(undefined)).toBeNull()
  })
})

describe('toReviewCacheInput', () => {
  const base = {
    reviewId: 'r1',
    reviewer: { displayName: 'Maria', profilePhotoUrl: 'https://p/1' },
    starRating: 'FOUR',
    comment: 'Ótimo atendimento',
    createTime: '2026-11-10T10:00:00Z',
    updateTime: '2026-11-11T10:00:00Z',
  }

  it('maps a review with its reply', () => {
    const input = toReviewCacheInput({
      ...base,
      reviewReply: {
        comment: ' Obrigado! ',
        updateTime: '2026-11-12T10:00:00Z',
      },
    })
    expect(input).toMatchObject({
      googleReviewId: 'r1',
      reviewerName: 'Maria',
      starRating: 4,
      comment: 'Ótimo atendimento',
      replyComment: 'Obrigado!',
    })
    expect(input?.replyUpdatedAt?.toISOString()).toBe(
      '2026-11-12T10:00:00.000Z',
    )
  })

  it('hides identity of anonymous reviewers', () => {
    const input = toReviewCacheInput({
      ...base,
      reviewer: { isAnonymous: true, displayName: 'Fulano' },
    })
    expect(input?.reviewerName).toBe('Usuário do Google')
    expect(input?.reviewerPhotoUrl).toBeNull()
  })

  it('keeps the original text of translated comments', () => {
    const input = toReviewCacheInput({
      ...base,
      comment: '(Translated by Google) Great!\n\n(Original)\nÓtimo!',
    })
    expect(input?.comment).toBe('Ótimo!')
  })

  it('accepts rating-only reviews', () => {
    const input = toReviewCacheInput({ ...base, comment: undefined })
    expect(input?.comment).toBeNull()
  })

  it('drops reviews without id, rating or date', () => {
    expect(toReviewCacheInput({ ...base, reviewId: undefined })).toBeNull()
    expect(toReviewCacheInput({ ...base, starRating: undefined })).toBeNull()
    expect(toReviewCacheInput({ ...base, createTime: 'nope' })).toBeNull()
  })

  it('takes the id from the resource name when reviewId is absent', () => {
    const input = toReviewCacheInput({
      ...base,
      reviewId: undefined,
      name: 'accounts/1/locations/2/reviews/abc',
    })
    expect(input?.googleReviewId).toBe('abc')
  })
})

describe('shouldAlertReview', () => {
  const recent = new Date(NOW.getTime() - 86_400_000)

  it('alerts on recent unanswered 1 and 2 star reviews', () => {
    expect(
      shouldAlertReview(
        { starRating: 1, reviewedAt: recent, replyComment: null },
        NOW,
      ),
    ).toBe(true)
    expect(
      shouldAlertReview(
        { starRating: 2, reviewedAt: recent, replyComment: null },
        NOW,
      ),
    ).toBe(true)
  })

  it('ignores 3+ stars, answered and old reviews', () => {
    expect(
      shouldAlertReview(
        { starRating: 3, reviewedAt: recent, replyComment: null },
        NOW,
      ),
    ).toBe(false)
    expect(
      shouldAlertReview(
        { starRating: 1, reviewedAt: recent, replyComment: 'ok' },
        NOW,
      ),
    ).toBe(false)
    expect(
      shouldAlertReview(
        {
          starRating: 1,
          reviewedAt: new Date(NOW.getTime() - ALERT_MAX_AGE_MS - 1),
          replyComment: null,
        },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('buildEvolution', () => {
  it('gives monthly and cumulative averages, counting older reviews in the base', () => {
    const points = buildEvolution(
      [
        { starRating: 1, reviewedAt: new Date('2025-01-10T00:00:00Z') },
        { starRating: 5, reviewedAt: new Date('2026-10-05T00:00:00Z') },
        { starRating: 3, reviewedAt: new Date('2026-10-20T00:00:00Z') },
        { starRating: 5, reviewedAt: new Date('2026-11-02T00:00:00Z') },
      ],
      3,
      NOW,
    )
    expect(points.map((p) => p.month)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ])
    expect(points[0]).toMatchObject({
      count: 0,
      average: null,
      cumulativeAverage: 1,
    })
    expect(points[1]).toMatchObject({
      count: 2,
      average: 4,
      cumulativeAverage: 3,
    })
    expect(points[2]).toMatchObject({
      count: 1,
      average: 5,
      cumulativeAverage: 3.5,
    })
  })

  it('returns nulls when there are no reviews', () => {
    const points = buildEvolution([], 2, NOW)
    expect(points.every((p) => p.cumulativeAverage === null)).toBe(true)
  })
})

describe('buildSummary', () => {
  it('counts distribution and response rate', () => {
    const summary = buildSummary({
      reviews: [
        { starRating: 5, reviewedAt: NOW, hasReply: true },
        { starRating: 5, reviewedAt: NOW, hasReply: false },
        { starRating: 1, reviewedAt: NOW, hasReply: false },
        { starRating: 3, reviewedAt: NOW, hasReply: true },
      ],
      averageRating: 4.2,
      totalReviewCount: 120,
      lastSyncAt: NOW,
      now: NOW,
    })
    expect(summary.distribution).toEqual({
      '1': 1,
      '2': 0,
      '3': 1,
      '4': 0,
      '5': 2,
    })
    expect(summary.repliedCount).toBe(2)
    expect(summary.unrepliedCount).toBe(2)
    expect(summary.responseRate).toBe(0.5)
    expect(summary.averageRating).toBe(4.2)
    expect(summary.totalReviewCount).toBe(120)
    expect(summary.evolution).toHaveLength(12)
    expect(summary.lastSyncAt).toBe(NOW.toISOString())
  })

  it('has no response rate without reviews', () => {
    const summary = buildSummary({
      reviews: [],
      averageRating: null,
      totalReviewCount: null,
      lastSyncAt: null,
      now: NOW,
    })
    expect(summary.responseRate).toBeNull()
    expect(summary.lastSyncAt).toBeNull()
  })
})
