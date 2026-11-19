import {
  GOOGLE_PERFORMANCE_RANGE_DAYS,
  type GoogleKeywordDTO,
  type GooglePerformanceDTO,
  type GooglePerformancePointDTO,
  type GooglePerformanceRange,
  type GooglePerformanceTotalsDTO,
} from '@/src/schemas/crm-google-presence.schema'
import type { RawDailyMetricSeries, RawSearchKeyword } from './client'

/** Pure rollups of the Business Profile Performance API. */

/** Days of history kept in the cache (covers 90d plus the previous 90d). */
export const METRICS_SYNC_DAYS = 180

/**
 * The Performance API closes a day 2-3 days late, so the freshest days come
 * back empty; the window ends this many days before today.
 */
export const METRICS_LAG_DAYS = 2

export type DailyMetricRow = {
  /** `YYYY-MM-DD` (UTC). */
  date: string
  impressionsMapsDesktop: number
  impressionsMapsMobile: number
  impressionsSearchDesktop: number
  impressionsSearchMobile: number
  callClicks: number
  directionRequests: number
  websiteClicks: number
}

const FIELD_BY_METRIC: Record<string, keyof Omit<DailyMetricRow, 'date'>> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'impressionsMapsDesktop',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'impressionsMapsMobile',
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'impressionsSearchDesktop',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'impressionsSearchMobile',
  CALL_CLICKS: 'callClicks',
  BUSINESS_DIRECTION_REQUESTS: 'directionRequests',
  WEBSITE_CLICKS: 'websiteClicks',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Folds the per-metric series into one row per day. */
export function seriesToDailyRows(
  series: RawDailyMetricSeries[],
): DailyMetricRow[] {
  const byDate = new Map<string, DailyMetricRow>()
  for (const metric of series) {
    const field = FIELD_BY_METRIC[metric.dailyMetric ?? '']
    if (!field) continue
    for (const point of metric.timeSeries?.datedValues ?? []) {
      const { year, month, day } = point.date ?? {}
      if (!year || !month || !day) continue
      const date = `${year}-${pad(month)}-${pad(day)}`
      const row = byDate.get(date) ?? {
        date,
        impressionsMapsDesktop: 0,
        impressionsMapsMobile: 0,
        impressionsSearchDesktop: 0,
        impressionsSearchMobile: 0,
        callClicks: 0,
        directionRequests: 0,
        websiteClicks: 0,
      }
      // The API omits `value` on days with zero.
      const value = Number.parseInt(point.value ?? '0', 10)
      row[field] = Number.isFinite(value) ? value : 0
      byDate.set(date, row)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Day `days` before `base` at 00:00 UTC. */
export function daysBefore(base: Date, days: number): Date {
  const start = Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
  )
  return new Date(start - days * 86_400_000)
}

/** Window to request from Google: oldest day and last closed day. */
export function syncWindow(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: daysBefore(now, METRICS_SYNC_DAYS + METRICS_LAG_DAYS),
    end: daysBefore(now, METRICS_LAG_DAYS),
  }
}

function totalsOf(rows: DailyMetricRow[]): GooglePerformanceTotalsDTO {
  const totals: GooglePerformanceTotalsDTO = {
    searchImpressions: 0,
    mapsImpressions: 0,
    callClicks: 0,
    directionRequests: 0,
    websiteClicks: 0,
  }
  for (const row of rows) {
    totals.searchImpressions +=
      row.impressionsSearchDesktop + row.impressionsSearchMobile
    totals.mapsImpressions +=
      row.impressionsMapsDesktop + row.impressionsMapsMobile
    totals.callClicks += row.callClicks
    totals.directionRequests += row.directionRequests
    totals.websiteClicks += row.websiteClicks
  }
  return totals
}

function pointOf(row: DailyMetricRow): GooglePerformancePointDTO {
  return {
    date: row.date,
    searchImpressions:
      row.impressionsSearchDesktop + row.impressionsSearchMobile,
    mapsImpressions: row.impressionsMapsDesktop + row.impressionsMapsMobile,
    callClicks: row.callClicks,
    directionRequests: row.directionRequests,
    websiteClicks: row.websiteClicks,
  }
}

/**
 * Cached daily rows → the dashboard payload for `range`: totals, the same
 * window right before it (for the % change), the surface split and a
 * zero-filled daily series so the chart has no holes.
 */
export function buildPerformance(input: {
  rows: DailyMetricRow[]
  range: GooglePerformanceRange
  syncedAt: Date | null
  now?: Date
}): GooglePerformanceDTO {
  const days = GOOGLE_PERFORMANCE_RANGE_DAYS[input.range]
  const end = daysBefore(input.now ?? new Date(), METRICS_LAG_DAYS)
  const start = daysBefore(end, days - 1)
  const previousStart = daysBefore(start, days)

  const startKey = isoDay(start)
  const endKey = isoDay(end)
  const previousStartKey = isoDay(previousStart)

  const current = input.rows.filter(
    (row) => row.date >= startKey && row.date <= endKey,
  )
  const previous = input.rows.filter(
    (row) => row.date >= previousStartKey && row.date < startKey,
  )

  const byDate = new Map(current.map((row) => [row.date, row]))
  const series: GooglePerformancePointDTO[] = []
  for (let i = 0; i < days; i++) {
    const key = isoDay(new Date(start.getTime() + i * 86_400_000))
    const row = byDate.get(key)
    series.push(
      row
        ? pointOf(row)
        : {
            date: key,
            searchImpressions: 0,
            mapsImpressions: 0,
            callClicks: 0,
            directionRequests: 0,
            websiteClicks: 0,
          },
    )
  }

  const sum = (pick: (row: DailyMetricRow) => number) =>
    current.reduce((acc, row) => acc + pick(row), 0)

  return {
    range: input.range,
    startDate: startKey,
    endDate: endKey,
    totals: totalsOf(current),
    previousTotals: totalsOf(previous),
    surfaces: {
      mapsMobile: sum((row) => row.impressionsMapsMobile),
      mapsDesktop: sum((row) => row.impressionsMapsDesktop),
      searchMobile: sum((row) => row.impressionsSearchMobile),
      searchDesktop: sum((row) => row.impressionsSearchDesktop),
    },
    series,
    syncedAt: input.syncedAt?.toISOString() ?? null,
    hasData: current.length > 0,
  }
}

/** Search terms with their impressions, biggest first. */
export function mapKeywords(raw: RawSearchKeyword[]): GoogleKeywordDTO[] {
  const merged = new Map<string, GoogleKeywordDTO>()
  for (const item of raw) {
    const keyword = item.searchKeyword?.trim()
    if (!keyword) continue
    const exact = item.insightsValue?.value
    const threshold = item.insightsValue?.threshold
    const impressions = Number.parseInt(exact ?? threshold ?? '0', 10)
    if (!Number.isFinite(impressions)) continue
    const current = merged.get(keyword)
    merged.set(keyword, {
      keyword,
      impressions: (current?.impressions ?? 0) + impressions,
      approximate: (current?.approximate ?? false) || exact === undefined,
    })
  }
  return [...merged.values()]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
}
