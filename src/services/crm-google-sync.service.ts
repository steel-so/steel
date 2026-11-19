import type { CrmGoogleBusinessConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { crmGoogleLocationNotSelected } from '@/src/errors'
import {
  fetchDailyMetrics,
  listReviewsPage,
} from '@/src/lib/google-business/client'
import {
  seriesToDailyRows,
  syncWindow,
} from '@/src/lib/google-business/metrics'
import {
  type ReviewCacheInput,
  shouldAlertReview,
  toReviewCacheInput,
} from '@/src/lib/google-business/reviews'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CrmGoogleConnectionRepository,
  CrmGoogleMetricRepository,
  CrmGoogleReviewRepository,
} from '@/src/repositories/crm-google-presence.repository'
import { notifyGoogleReviewNegative } from './crm-google-notifications'
import { freshAccessToken } from './crm-google-token'

/** Reviews come 50 per page; 40 pages cover 2.000 reviews. */
export const REVIEWS_MAX_PAGES = 40
/** Metrics are refreshed at most this often by the periodic tick. */
const METRICS_REFRESH_MS = 12 * 60 * 60 * 1000

export type SyncReviewsOptions = {
  /** Stop after this many pages (the select-location call syncs just two). */
  maxPages?: number
}

/**
 * Pulls the location's reviews into the cache. Newest first, so a partial
 * sync still gets the reviews that matter. When every page was read the
 * cache is pruned of reviews that disappeared from Google. New low-rated,
 * unanswered, recent reviews notify the admins (once, `alertedAt`).
 */
export async function syncReviews(
  connection: CrmGoogleBusinessConnection,
  options: SyncReviewsOptions = {},
): Promise<Result<{ synced: number; created: number; complete: boolean }>> {
  if (!connection.accountName || !connection.locationName) {
    return err(crmGoogleLocationNotSelected())
  }
  const access = await freshAccessToken(connection)
  if (!access.ok) return access
  const fullName = `${connection.accountName}/${connection.locationName}`
  const maxPages = options.maxPages ?? REVIEWS_MAX_PAGES

  const inputs: ReviewCacheInput[] = []
  let averageRating: number | null = null
  let totalReviewCount: number | null = null
  let pageToken: string | undefined
  let complete = false

  for (let page = 0; page < maxPages; page++) {
    const result = await listReviewsPage(
      access.value.accessToken,
      fullName,
      pageToken,
    )
    if (!result.ok) {
      await CrmGoogleConnectionRepository.recordSync(connection.id, {
        lastSyncError: result.error.message,
      })
      return result
    }
    averageRating = result.value.averageRating ?? averageRating
    totalReviewCount = result.value.totalReviewCount ?? totalReviewCount
    for (const raw of result.value.reviews ?? []) {
      const input = toReviewCacheInput(raw)
      if (input) inputs.push(input)
    }
    pageToken = result.value.nextPageToken
    if (!pageToken) {
      complete = true
      break
    }
  }

  const created = await CrmGoogleReviewRepository.upsertMany(
    connection.id,
    connection.workspaceId,
    inputs,
  )
  if (!created.ok) return created

  if (complete) {
    await CrmGoogleReviewRepository.deleteMissing(
      connection.id,
      inputs.map((input) => input.googleReviewId),
    )
  }

  const alertable = created.value.filter((review) => shouldAlertReview(review))
  for (const review of alertable) {
    await notifyGoogleReviewNegative({
      workspaceId: connection.workspaceId,
      googleReviewId: review.googleReviewId,
      starRating: review.starRating,
      reviewerName: review.reviewerName,
      comment: review.comment,
      locationTitle: connection.locationTitle ?? 'seu local',
    })
  }
  await CrmGoogleReviewRepository.markAlerted(alertable.map((r) => r.id))

  await CrmGoogleConnectionRepository.recordSync(connection.id, {
    averageRating,
    totalReviewCount,
    lastReviewsSyncAt: new Date(),
    lastSyncError: null,
  })

  return ok({ synced: inputs.length, created: created.value.length, complete })
}

/** Pulls the daily Performance metrics of the last 180 days into the cache. */
export async function syncMetrics(
  connection: CrmGoogleBusinessConnection,
): Promise<Result<{ days: number }>> {
  if (!connection.locationName) return err(crmGoogleLocationNotSelected())
  const access = await freshAccessToken(connection)
  if (!access.ok) return access

  const { start, end } = syncWindow()
  const series = await fetchDailyMetrics(
    access.value.accessToken,
    connection.locationName,
    start,
    end,
  )
  if (!series.ok) {
    await CrmGoogleConnectionRepository.recordSync(connection.id, {
      lastSyncError: series.error.message,
    })
    return series
  }

  const rows = seriesToDailyRows(series.value)
  const saved = await CrmGoogleMetricRepository.upsertMany(connection.id, rows)
  if (!saved.ok) return saved

  await CrmGoogleConnectionRepository.recordSync(connection.id, {
    lastMetricsSyncAt: new Date(),
    lastSyncError: null,
  })
  return ok({ days: rows.length })
}

export type SyncAllResult = {
  processed: number
  synced: number
  failed: number
}

export const CrmGoogleSyncService = {
  /**
   * The worker tick: every connected workspace gets its reviews refreshed and,
   * at most twice a day, its metrics. One workspace failing never stops the
   * others (the error is stored on the connection and shown on the screens).
   */
  async syncAll(now: Date = new Date()): Promise<SyncAllResult> {
    const result: SyncAllResult = { processed: 0, synced: 0, failed: 0 }
    const connections = await CrmGoogleConnectionRepository.listSyncable()
    if (!connections.ok) {
      logger.error('crm_google_sync.list_failed', {
        component: 'CrmGoogleSyncService',
        code: connections.error.code,
      })
      return result
    }

    for (const connection of connections.value) {
      result.processed += 1
      try {
        const reviews = await syncReviews(connection)
        const metricsDue =
          !connection.lastMetricsSyncAt ||
          now.getTime() - connection.lastMetricsSyncAt.getTime() >
            METRICS_REFRESH_MS
        const metrics = metricsDue ? await syncMetrics(connection) : null
        if (reviews.ok && (metrics === null || metrics.ok)) result.synced += 1
        else result.failed += 1
      } catch (error) {
        result.failed += 1
        logger.error('crm_google_sync.connection_failed', {
          component: 'CrmGoogleSyncService',
          workspaceId: connection.workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  },

  /** Manual "Atualizar agora" from the reviews screen. */
  async syncOne(
    connection: CrmGoogleBusinessConnection,
  ): Promise<Result<{ synced: number; created: number; complete: boolean }>> {
    return syncReviews(connection)
  },
}
