import { crmSocialConnectionNotFound } from '@/src/errors'
import { fetchSearchKeywords } from '@/src/lib/google-business/client'
import {
  buildPerformance,
  daysBefore,
  METRICS_SYNC_DAYS,
  mapKeywords,
  syncWindow,
} from '@/src/lib/google-business/metrics'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CrmGoogleConnectionRepository,
  CrmGoogleMetricRepository,
} from '@/src/repositories/crm-google-presence.repository'
import type {
  GoogleKeywordDTO,
  GooglePerformanceDTO,
  GooglePerformanceRange,
} from '@/src/schemas/crm-google-presence.schema'
import { assertModuleMember } from './authz'
import { syncMetrics } from './crm-google-sync.service'
import { googleLocationAccessFor } from './crm-google-token'

const SOCIAL = 'social' as const
/** The cache is refreshed on read when it is older than this. */
const STALE_MS = 6 * 60 * 60 * 1000

export const CrmGooglePerformanceService = {
  /**
   * Performance of the location in `range`. Reads the cached daily rows; when
   * the cache is empty or older than 6h it is refreshed from Google first (the
   * worker keeps it warm, this covers the first visit and a stalled worker).
   */
  async get(
    actorId: string,
    workspaceId: string,
    range: GooglePerformanceRange,
  ): Promise<Result<GooglePerformanceDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    let connection = access.value.connection

    const stale =
      !connection.lastMetricsSyncAt ||
      Date.now() - connection.lastMetricsSyncAt.getTime() > STALE_MS
    if (stale) {
      const synced = await syncMetrics(connection)
      // No cache to fall back on: show the real reason.
      if (!synced.ok && !connection.lastMetricsSyncAt) return synced
      const reloaded =
        await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
      if (!reloaded.ok) return reloaded
      if (!reloaded.value) return err(crmSocialConnectionNotFound())
      connection = reloaded.value
    }

    const rows = await CrmGoogleMetricRepository.listSince(
      connection.id,
      daysBefore(new Date(), METRICS_SYNC_DAYS + 2),
    )
    if (!rows.ok) return rows
    return ok(
      buildPerformance({
        range,
        syncedAt: connection.lastMetricsSyncAt,
        rows: rows.value.map((row) => ({
          date: row.date.toISOString().slice(0, 10),
          impressionsMapsDesktop: row.impressionsMapsDesktop,
          impressionsMapsMobile: row.impressionsMapsMobile,
          impressionsSearchDesktop: row.impressionsSearchDesktop,
          impressionsSearchMobile: row.impressionsSearchMobile,
          callClicks: row.callClicks,
          directionRequests: row.directionRequests,
          websiteClicks: row.websiteClicks,
        })),
      }),
    )
  },

  /** Search terms that made the business appear, last 3 closed months. */
  async keywords(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleKeywordDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access

    const { end } = syncWindow()
    const endMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
    )
    const startMonth = new Date(
      Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 2, 1),
    )
    const result = await fetchSearchKeywords(
      access.value.accessToken,
      access.value.locationName,
      startMonth,
      endMonth,
    )
    if (!result.ok) return result
    return ok(mapKeywords(result.value))
  },
}
