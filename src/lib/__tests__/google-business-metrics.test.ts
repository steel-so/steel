import { describe, expect, it } from 'vitest'
import {
  buildPerformance,
  type DailyMetricRow,
  mapKeywords,
  seriesToDailyRows,
  syncWindow,
} from '@/src/lib/google-business/metrics'

const NOW = new Date('2026-11-19T12:00:00Z')

function row(
  date: string,
  overrides: Partial<DailyMetricRow> = {},
): DailyMetricRow {
  return {
    date,
    impressionsMapsDesktop: 0,
    impressionsMapsMobile: 0,
    impressionsSearchDesktop: 0,
    impressionsSearchMobile: 0,
    callClicks: 0,
    directionRequests: 0,
    websiteClicks: 0,
    ...overrides,
  }
}

describe('seriesToDailyRows', () => {
  it('folds the per-metric series into one row per day', () => {
    const rows = seriesToDailyRows([
      {
        dailyMetric: 'CALL_CLICKS',
        timeSeries: {
          datedValues: [
            { date: { year: 2026, month: 11, day: 2 }, value: '4' },
            { date: { year: 2026, month: 11, day: 1 }, value: '1' },
          ],
        },
      },
      {
        dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
        timeSeries: {
          datedValues: [
            { date: { year: 2026, month: 11, day: 1 }, value: '30' },
          ],
        },
      },
      { dailyMetric: 'UNKNOWN_METRIC', timeSeries: { datedValues: [] } },
    ])
    expect(rows).toEqual([
      row('2026-11-01', { callClicks: 1, impressionsMapsMobile: 30 }),
      row('2026-11-02', { callClicks: 4 }),
    ])
  })

  it('treats a missing value as zero', () => {
    const rows = seriesToDailyRows([
      {
        dailyMetric: 'WEBSITE_CLICKS',
        timeSeries: {
          datedValues: [{ date: { year: 2026, month: 1, day: 5 } }],
        },
      },
    ])
    expect(rows[0].websiteClicks).toBe(0)
  })
})

describe('syncWindow', () => {
  it('ends two days before today and spans 180 days', () => {
    const { start, end } = syncWindow(NOW)
    expect(end.toISOString().slice(0, 10)).toBe('2026-11-17')
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(180)
  })
})

describe('buildPerformance', () => {
  it('sums the window, compares with the previous one and fills gaps', () => {
    const result = buildPerformance({
      range: '7d',
      syncedAt: NOW,
      now: NOW,
      rows: [
        // current window: 2026-11-11 .. 2026-11-17
        row('2026-11-11', { callClicks: 2, impressionsSearchMobile: 10 }),
        row('2026-11-17', {
          callClicks: 3,
          impressionsSearchDesktop: 5,
          impressionsMapsMobile: 7,
          directionRequests: 1,
          websiteClicks: 4,
        }),
        // previous window: 2026-11-04 .. 2026-11-10
        row('2026-11-05', { callClicks: 2 }),
        // outside both
        row('2026-10-01', { callClicks: 99 }),
      ],
    })
    expect(result.startDate).toBe('2026-11-11')
    expect(result.endDate).toBe('2026-11-17')
    expect(result.series).toHaveLength(7)
    expect(result.totals).toEqual({
      searchImpressions: 15,
      mapsImpressions: 7,
      callClicks: 5,
      directionRequests: 1,
      websiteClicks: 4,
    })
    expect(result.previousTotals.callClicks).toBe(2)
    expect(result.surfaces).toEqual({
      mapsMobile: 7,
      mapsDesktop: 0,
      searchMobile: 10,
      searchDesktop: 5,
    })
    expect(result.hasData).toBe(true)
    expect(result.series[1].callClicks).toBe(0)
  })

  it('reports no data when the cache is empty', () => {
    const result = buildPerformance({
      range: '28d',
      syncedAt: null,
      now: NOW,
      rows: [],
    })
    expect(result.hasData).toBe(false)
    expect(result.series).toHaveLength(28)
    expect(result.syncedAt).toBeNull()
  })
})

describe('mapKeywords', () => {
  it('orders by impressions and marks threshold-only values', () => {
    const keywords = mapKeywords([
      { searchKeyword: 'padaria', insightsValue: { value: '120' } },
      { searchKeyword: 'pão', insightsValue: { threshold: '15' } },
      { searchKeyword: '  ', insightsValue: { value: '9' } },
      { searchKeyword: 'padaria', insightsValue: { value: '30' } },
    ])
    expect(keywords).toEqual([
      { keyword: 'padaria', impressions: 150, approximate: false },
      { keyword: 'pão', impressions: 15, approximate: true },
    ])
  })
})
