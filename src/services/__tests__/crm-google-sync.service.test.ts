import type { CrmGoogleBusinessConnection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crmSocialTokenExpired } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  freshAccessToken: vi.fn(),
  listReviewsPage: vi.fn(),
  fetchDailyMetrics: vi.fn(),
  upsertMany: vi.fn(),
  deleteMissing: vi.fn(),
  markAlerted: vi.fn(),
  recordSync: vi.fn(),
  listSyncable: vi.fn(),
  upsertMetrics: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-google-token', () => ({
  freshAccessToken: mocks.freshAccessToken,
}))
vi.mock('@/src/lib/google-business/client', () => ({
  listReviewsPage: mocks.listReviewsPage,
  fetchDailyMetrics: mocks.fetchDailyMetrics,
}))
vi.mock('@/src/services/crm-google-notifications', () => ({
  notifyGoogleReviewNegative: mocks.notify,
}))
vi.mock('@/src/repositories/crm-google-presence.repository', () => ({
  CrmGoogleReviewRepository: {
    upsertMany: mocks.upsertMany,
    deleteMissing: mocks.deleteMissing,
    markAlerted: mocks.markAlerted,
  },
  CrmGoogleConnectionRepository: {
    recordSync: mocks.recordSync,
    listSyncable: mocks.listSyncable,
  },
  CrmGoogleMetricRepository: { upsertMany: mocks.upsertMetrics },
}))

const { CrmGoogleSyncService, syncMetrics, syncReviews } = await import(
  '@/src/services/crm-google-sync.service'
)

const connection = {
  id: 'conn-1',
  workspaceId: 'ws-1',
  accountName: 'accounts/1',
  locationName: 'locations/2',
  locationTitle: 'Padaria',
  lastMetricsSyncAt: null,
} as unknown as CrmGoogleBusinessConnection

const recent = new Date(Date.now() - 3_600_000)
const rawReview = (id: string, stars: string) => ({
  reviewId: id,
  reviewer: { displayName: `Cliente ${id}` },
  starRating: stars,
  comment: 'texto',
  createTime: recent.toISOString(),
  updateTime: recent.toISOString(),
})

function row(id: string, starRating: number) {
  return {
    id: `row-${id}`,
    googleReviewId: id,
    starRating,
    reviewerName: `Cliente ${id}`,
    comment: 'texto',
    reviewedAt: recent,
    replyComment: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.freshAccessToken.mockResolvedValue(
    ok({ accessToken: 'token', connection }),
  )
  mocks.deleteMissing.mockResolvedValue(ok(undefined))
  mocks.markAlerted.mockResolvedValue(ok(undefined))
  mocks.recordSync.mockResolvedValue(ok(undefined))
  mocks.upsertMetrics.mockResolvedValue(ok(undefined))
})

describe('syncReviews', () => {
  it('alerts only for the new negative reviews and marks them', async () => {
    mocks.listReviewsPage.mockResolvedValue(
      ok({
        reviews: [rawReview('a', 'ONE'), rawReview('b', 'FIVE')],
        averageRating: 4.1,
        totalReviewCount: 2,
      }),
    )
    mocks.upsertMany.mockResolvedValue(ok([row('a', 1), row('b', 5)]))

    const result = await syncReviews(connection)

    expect(result).toEqual(ok({ synced: 2, created: 2, complete: true }))
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        googleReviewId: 'a',
        starRating: 1,
        locationTitle: 'Padaria',
      }),
    )
    expect(mocks.markAlerted).toHaveBeenCalledWith(['row-a'])
    expect(mocks.recordSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        averageRating: 4.1,
        totalReviewCount: 2,
        lastSyncError: null,
      }),
    )
  })

  it('does not alert for reviews that were already cached', async () => {
    mocks.listReviewsPage.mockResolvedValue(
      ok({ reviews: [rawReview('a', 'ONE')] }),
    )
    mocks.upsertMany.mockResolvedValue(ok([]))

    await syncReviews(connection)

    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.markAlerted).toHaveBeenCalledWith([])
  })

  it('prunes deleted reviews only after reading every page', async () => {
    mocks.listReviewsPage
      .mockResolvedValueOnce(
        ok({ reviews: [rawReview('a', 'FIVE')], nextPageToken: 'next' }),
      )
      .mockResolvedValueOnce(ok({ reviews: [rawReview('b', 'FOUR')] }))
    mocks.upsertMany.mockResolvedValue(ok([]))

    const full = await syncReviews(connection)
    expect(full).toEqual(ok({ synced: 2, created: 0, complete: true }))
    expect(mocks.deleteMissing).toHaveBeenCalledWith('conn-1', ['a', 'b'])

    mocks.deleteMissing.mockClear()
    mocks.listReviewsPage.mockResolvedValue(
      ok({ reviews: [rawReview('a', 'FIVE')], nextPageToken: 'more' }),
    )
    const partial = await syncReviews(connection, { maxPages: 1 })
    expect(partial).toEqual(ok({ synced: 1, created: 0, complete: false }))
    expect(mocks.deleteMissing).not.toHaveBeenCalled()
  })

  it('stores the error when Google fails', async () => {
    mocks.listReviewsPage.mockResolvedValue(err(crmSocialTokenExpired()))

    const result = await syncReviews(connection)

    expect(result.ok).toBe(false)
    expect(mocks.upsertMany).not.toHaveBeenCalled()
    expect(mocks.recordSync).toHaveBeenCalledWith('conn-1', {
      lastSyncError: expect.stringContaining('expirou'),
    })
  })

  it('needs a chosen location', async () => {
    const result = await syncReviews({
      ...connection,
      locationName: null,
    } as CrmGoogleBusinessConnection)
    expect(result.ok).toBe(false)
    expect(mocks.listReviewsPage).not.toHaveBeenCalled()
  })
})

describe('syncMetrics', () => {
  it('caches the daily rows and stamps the sync time', async () => {
    mocks.fetchDailyMetrics.mockResolvedValue(
      ok([
        {
          dailyMetric: 'CALL_CLICKS',
          timeSeries: {
            datedValues: [
              { date: { year: 2026, month: 11, day: 1 }, value: '3' },
            ],
          },
        },
      ]),
    )

    const result = await syncMetrics(connection)

    expect(result).toEqual(ok({ days: 1 }))
    expect(mocks.upsertMetrics).toHaveBeenCalledWith('conn-1', [
      expect.objectContaining({ date: '2026-11-01', callClicks: 3 }),
    ])
    expect(mocks.recordSync).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ lastSyncError: null }),
    )
  })
})

describe('CrmGoogleSyncService.syncAll', () => {
  it('counts synced and failed workspaces without stopping at the first failure', async () => {
    const second = { ...connection, id: 'conn-2', workspaceId: 'ws-2' }
    mocks.listSyncable.mockResolvedValue(ok([connection, second]))
    mocks.listReviewsPage
      .mockResolvedValueOnce(ok({ reviews: [] }))
      .mockResolvedValueOnce(err(crmSocialTokenExpired()))
    mocks.upsertMany.mockResolvedValue(ok([]))
    mocks.fetchDailyMetrics.mockResolvedValue(ok([]))

    const result = await CrmGoogleSyncService.syncAll()

    expect(result).toEqual({ processed: 2, synced: 1, failed: 1 })
  })

  it('skips metrics refreshed in the last 12 hours', async () => {
    mocks.listSyncable.mockResolvedValue(
      ok([{ ...connection, lastMetricsSyncAt: new Date() }]),
    )
    mocks.listReviewsPage.mockResolvedValue(ok({ reviews: [] }))
    mocks.upsertMany.mockResolvedValue(ok([]))

    await CrmGoogleSyncService.syncAll()

    expect(mocks.fetchDailyMetrics).not.toHaveBeenCalled()
  })

  it('returns zeros when the list fails', async () => {
    mocks.listSyncable.mockResolvedValue(err(crmSocialTokenExpired()))
    expect(await CrmGoogleSyncService.syncAll()).toEqual({
      processed: 0,
      synced: 0,
      failed: 0,
    })
  })
})
