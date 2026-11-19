import type { CrmGoogleBusinessConnection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forbidden, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  assertModuleMember: vi.fn(),
  locationAccess: vi.fn(),
  putReviewReply: vi.fn(),
  deleteReviewReply: vi.fn(),
  findByGoogleId: vi.fn(),
  setReply: vi.fn(),
  findConnection: vi.fn(),
  list: vi.fn(),
  runSuggestion: vi.fn(),
  auditMutation: vi.fn(),
}))

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: mocks.auditMutation }))
vi.mock('@/src/services/authz', () => ({
  assertModuleMember: mocks.assertModuleMember,
}))
vi.mock('@/src/services/crm-google-token', () => ({
  googleLocationAccessFor: mocks.locationAccess,
}))
vi.mock('@/src/services/crm-google-ai', () => ({
  runGoogleSuggestion: mocks.runSuggestion,
}))
vi.mock('@/src/services/crm-google-sync.service', () => ({
  syncReviews: vi.fn(),
}))
vi.mock('@/src/lib/google-business/client', () => ({
  putReviewReply: mocks.putReviewReply,
  deleteReviewReply: mocks.deleteReviewReply,
}))
vi.mock('@/src/repositories/crm-google-presence.repository', () => ({
  CrmGoogleReviewRepository: {
    findByGoogleId: mocks.findByGoogleId,
    setReply: mocks.setReply,
    list: mocks.list,
  },
  CrmGoogleConnectionRepository: { findByWorkspace: mocks.findConnection },
}))

const { CrmGoogleReviewsService } = await import(
  '@/src/services/crm-google-reviews.service'
)

const connection = {
  id: 'conn-1',
  locationTitle: 'Padaria',
  replyTone: 'Cordial',
} as unknown as CrmGoogleBusinessConnection

const review = {
  id: 'row-1',
  googleReviewId: 'g1',
  reviewerName: 'Ana',
  reviewerPhotoUrl: null,
  starRating: 2,
  comment: 'Demorou',
  reviewedAt: new Date('2026-11-10T10:00:00Z'),
  replyComment: null,
  replyUpdatedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.assertModuleMember.mockResolvedValue(ok({}))
  mocks.locationAccess.mockResolvedValue(
    ok({
      accessToken: 'token',
      connection,
      accountName: 'accounts/1',
      locationName: 'locations/2',
      fullLocationName: 'accounts/1/locations/2',
    }),
  )
  mocks.findByGoogleId.mockResolvedValue(ok(review))
  mocks.findConnection.mockResolvedValue(ok(connection))
})

describe('CrmGoogleReviewsService.reply', () => {
  it('publishes on Google, saves the reply and audits it', async () => {
    mocks.putReviewReply.mockResolvedValue(
      ok({ comment: 'Sentimos muito.', updateTime: '2026-11-11T09:00:00Z' }),
    )
    mocks.setReply.mockResolvedValue(
      ok({
        ...review,
        replyComment: 'Sentimos muito.',
        replyUpdatedAt: new Date('2026-11-11T09:00:00Z'),
      }),
    )

    const result = await CrmGoogleReviewsService.reply(
      'u1',
      'ws1',
      'g1',
      'Sentimos muito.',
    )

    expect(mocks.putReviewReply).toHaveBeenCalledWith(
      'token',
      'accounts/1/locations/2',
      'g1',
      'Sentimos muito.',
    )
    expect(result.ok && result.value.reply?.comment).toBe('Sentimos muito.')
    expect(mocks.auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_google_review', action: 'send' }),
    )
  })

  it('does not touch Google or the cache when the actor may not edit', async () => {
    mocks.assertModuleMember.mockResolvedValue(err(forbidden()))

    const result = await CrmGoogleReviewsService.reply('u1', 'ws1', 'g1', 'Oi')

    expect(result.ok).toBe(false)
    expect(mocks.putReviewReply).not.toHaveBeenCalled()
    expect(mocks.setReply).not.toHaveBeenCalled()
  })

  it('answers review-not-found for reviews outside the cache', async () => {
    mocks.findByGoogleId.mockResolvedValue(err(notFound('CrmGoogleReview')))

    const result = await CrmGoogleReviewsService.reply('u1', 'ws1', 'zzz', 'Oi')

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.code).toBe('CRM_GOOGLE_REVIEW_NOT_FOUND')
    expect(mocks.putReviewReply).not.toHaveBeenCalled()
  })

  it('keeps the cache untouched when Google refuses', async () => {
    mocks.putReviewReply.mockResolvedValue(err(forbidden()))

    const result = await CrmGoogleReviewsService.reply('u1', 'ws1', 'g1', 'Oi')

    expect(result.ok).toBe(false)
    expect(mocks.setReply).not.toHaveBeenCalled()
  })
})

describe('CrmGoogleReviewsService.suggestReply', () => {
  it('builds the prompt from the cached review and the brand tone', async () => {
    mocks.runSuggestion.mockResolvedValue(
      ok('Olá, Ana! Sentimos muito pela demora.'),
    )

    const result = await CrmGoogleReviewsService.suggestReply('u1', 'ws1', 'g1')

    expect(result).toEqual(
      ok({ suggestion: 'Olá, Ana! Sentimos muito pela demora.' }),
    )
    const call = mocks.runSuggestion.mock.calls[0][0]
    expect(call.surface).toBe('review_reply')
    expect(call.system).toContain('Padaria')
    expect(call.system).toContain('Cordial')
    expect(call.system).toContain('Avaliação negativa')
    expect(call.user).toContain('Demorou')
  })

  it('passes the AI error through (quota, plan)', async () => {
    mocks.runSuggestion.mockResolvedValue(err(forbidden()))
    const result = await CrmGoogleReviewsService.suggestReply('u1', 'ws1', 'g1')
    expect(result.ok).toBe(false)
  })
})

describe('CrmGoogleReviewsService.list', () => {
  it('returns an empty page when the workspace has no connection', async () => {
    mocks.findConnection.mockResolvedValue(ok(null))

    const result = await CrmGoogleReviewsService.list('u1', 'ws1', {
      page: 1,
      pageSize: 20,
    })

    expect(result).toEqual(
      ok({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }),
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('maps rows and computes the page count', async () => {
    mocks.list.mockResolvedValue(ok({ items: [review], total: 45 }))

    const result = await CrmGoogleReviewsService.list('u1', 'ws1', {
      page: 2,
      pageSize: 20,
      rating: 2,
    })

    expect(mocks.list).toHaveBeenCalledWith(
      'conn-1',
      { rating: 2, replied: undefined, q: undefined },
      2,
      20,
    )
    expect(result.ok && result.value.totalPages).toBe(3)
    expect(result.ok && result.value.items[0].id).toBe('g1')
  })
})
