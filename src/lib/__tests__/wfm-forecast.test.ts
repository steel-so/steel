import { describe, expect, it } from 'vitest'
import {
  buildWfmProfile,
  isValidWfmTimeZone,
  isWfmShiftValid,
  WFM_DECAY,
  wfmAgentsFor,
  wfmDailyTotals,
  wfmForecastHours,
  wfmHeatmap,
  wfmLocalParts,
  wfmShiftCrossesMidnight,
  wfmShiftDemand,
  wfmShiftHours,
  wfmSlotForecast,
  wfmStartOfLocalDay,
} from '../servicedesk/wfm-forecast'

const HOUR = 3_600_000
const TZ = 'America/Sao_Paulo'
// Wednesday 2026-11-04 15:30 UTC = 12:30 in São Paulo (UTC-3)
const NOW = new Date('2026-11-04T15:30:00Z')
const PARAMS = {
  ticketsPerAgentHour: 2,
  targetOccupancyPercent: 100,
  minAgentsPerShift: 1,
}

function constantHistory(weeks: number, perHour: number) {
  // every hour of the last `weeks` weeks gets `perHour` tickets
  const rows = []
  const base = Math.floor(NOW.getTime() / HOUR) * HOUR
  for (let i = 0; i < weeks * 168; i++) {
    rows.push({ bucket: new Date(base - i * HOUR), count: perHour })
  }
  return rows
}

describe('time helpers', () => {
  it('reads the local day, weekday and hour', () => {
    expect(wfmLocalParts(new Date('2026-11-04T02:00:00Z'), TZ)).toEqual({
      dateKey: '2026-11-03',
      dow: 2,
      hour: 23,
    })
    expect(wfmLocalParts(new Date('2026-11-04T03:00:00Z'), TZ)).toEqual({
      dateKey: '2026-11-04',
      dow: 3,
      hour: 0,
    })
    expect(wfmLocalParts(new Date('2026-11-01T15:00:00Z'), 'UTC').dow).toBe(0)
  })

  it('finds the start of the local day', () => {
    expect(wfmStartOfLocalDay(NOW, TZ).toISOString()).toBe(
      '2026-11-04T03:00:00.000Z',
    )
    expect(wfmStartOfLocalDay(NOW, 'UTC').toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    )
  })

  it('validates time zones', () => {
    expect(isValidWfmTimeZone('America/Sao_Paulo')).toBe(true)
    expect(isValidWfmTimeZone('Nope/Zone')).toBe(false)
  })
})

describe('shifts', () => {
  it('validates shifts and measures them', () => {
    expect(isWfmShiftValid({ name: 'a', startHour: 6, endHour: 14 })).toBe(true)
    expect(isWfmShiftValid({ name: 'a', startHour: 6, endHour: 6 })).toBe(false)
    expect(isWfmShiftValid({ name: 'a', startHour: 24, endHour: 6 })).toBe(
      false,
    )
    expect(isWfmShiftValid({ name: 'a', startHour: 1.5, endHour: 6 })).toBe(
      false,
    )
    expect(isWfmShiftValid({ name: 'a', startHour: 0, endHour: 0 })).toBe(false)
    const night = { name: 'n', startHour: 22, endHour: 6 }
    expect(wfmShiftCrossesMidnight(night)).toBe(true)
    expect(wfmShiftHours(night)).toBe(8)
    expect(wfmShiftHours({ name: 'd', startHour: 0, endHour: 24 })).toBe(24)
  })
})

describe('buildWfmProfile', () => {
  it('flags an empty history as insufficient', () => {
    const profile = buildWfmProfile([], NOW, 4, TZ)
    expect(profile.insufficient).toBe(true)
    expect(profile.totalTickets).toBe(0)
    expect(profile.trend).toBe(1)
    expect(
      wfmHeatmap(profile)
        .flat()
        .every((v) => v === 0),
    ).toBe(true)
  })

  it('flags a single week as insufficient even with volume', () => {
    const profile = buildWfmProfile(constantHistory(1, 1), NOW, 4, TZ)
    expect(profile.weeksWithData).toBe(1)
    expect(profile.insufficient).toBe(true)
  })

  it('accepts a regular multi-week history', () => {
    const profile = buildWfmProfile(constantHistory(4, 2), NOW, 4, TZ)
    expect(profile.insufficient).toBe(false)
    expect(profile.weeksWithData).toBe(4)
    expect(profile.trend).toBe(1)
    expect(wfmHeatmap(profile)[3][10]).toBe(2)
  })

  it('ignores future, empty and out-of-window rows', () => {
    const profile = buildWfmProfile(
      [
        { bucket: new Date(NOW.getTime() + HOUR), count: 5 },
        { bucket: new Date(NOW.getTime() - HOUR), count: 0 },
        { bucket: new Date(NOW.getTime() - 10 * 7 * 24 * HOUR), count: 9 },
      ],
      NOW,
      4,
      TZ,
    )
    expect(profile.totalTickets).toBe(0)
  })

  it('applies a clamped growth trend', () => {
    const rows = []
    const base = Math.floor(NOW.getTime() / HOUR) * HOUR
    // recent two weeks: 10x the older two
    for (let i = 0; i < 4 * 168; i++) {
      rows.push({
        bucket: new Date(base - i * HOUR),
        count: i < 2 * 168 ? 10 : 1,
      })
    }
    expect(buildWfmProfile(rows, NOW, 4, TZ).trend).toBe(1.5)
    const falling = rows.map((r) => ({
      ...r,
      count: r.count === 10 ? 1 : 10,
    }))
    expect(buildWfmProfile(falling, NOW, 4, TZ).trend).toBe(0.7)
  })

  it('keeps trend 1 for short windows', () => {
    expect(buildWfmProfile(constantHistory(2, 3), NOW, 3, TZ).trend).toBe(1)
  })
})

describe('wfmSlotForecast', () => {
  it('returns zeros without data', () => {
    expect(wfmSlotForecast([], 1)).toEqual([0, 0, 0])
    expect(wfmSlotForecast([0, 0, 0], 1)).toEqual([0, 0, 0])
  })

  it('weights recent weeks more and builds a band', () => {
    const [expected, low, high] = wfmSlotForecast([10, 0], 1)
    const w = WFM_DECAY
    expect(expected).toBeCloseTo(10 / (1 + w))
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeGreaterThan(expected)
    expect(wfmSlotForecast([4, 4, 4], 1)).toEqual([4, 4, 4])
    expect(wfmSlotForecast([4, 4], 2)[0]).toBe(8)
  })
})

describe('forecast and staffing', () => {
  const profile = buildWfmProfile(constantHistory(4, 2), NOW, 4, TZ)
  const start = wfmStartOfLocalDay(NOW, TZ)

  it('forecasts hour by hour with local day keys', () => {
    const points = wfmForecastHours(profile, start, 48, TZ)
    expect(points).toHaveLength(48)
    expect(points[0]).toMatchObject({ dateKey: '2026-11-04', hour: 0, dow: 3 })
    expect(points[0].expected).toBe(2)
    const days = wfmDailyTotals(points)
    expect(days).toHaveLength(2)
    expect(days[0]).toMatchObject({ dateKey: '2026-11-04', expected: 48 })
  })

  it('sizes a day shift: ceil(volume / (rate * hours * occupancy))', () => {
    const points = wfmForecastHours(profile, start, 3 * 24, TZ)
    const rows = wfmShiftDemand(
      points,
      [{ name: 'Dia', startHour: 8, endHour: 16 }],
      PARAMS,
      2,
    )
    expect(rows).toHaveLength(2)
    // 8h * 2 tickets = 16 tickets; capacity 2/h * 8h = 16 -> 1 agent
    expect(rows[0]).toMatchObject({
      shift: 'Dia',
      hours: 8,
      expected: 16,
      suggestedAgents: 1,
    })
    const busy = wfmShiftDemand(
      points,
      [{ name: 'Dia', startHour: 8, endHour: 16 }],
      { ...PARAMS, targetOccupancyPercent: 50 },
      1,
    )
    expect(busy[0].suggestedAgents).toBe(2)
  })

  it('respects the minimum when there is no volume', () => {
    const empty = buildWfmProfile([], NOW, 4, TZ)
    const points = wfmForecastHours(empty, start, 48, TZ)
    const rows = wfmShiftDemand(
      points,
      [{ name: 'Dia', startHour: 8, endHour: 16 }],
      { ...PARAMS, minAgentsPerShift: 3 },
      1,
    )
    expect(rows[0]).toMatchObject({ expected: 0, suggestedAgents: 3 })
    expect(wfmAgentsFor(10, 8, { ...PARAMS, ticketsPerAgentHour: 0 })).toBe(1)
  })

  it('assigns a shift that crosses midnight to the day it starts', () => {
    const points = wfmForecastHours(profile, start, 3 * 24, TZ)
    const rows = wfmShiftDemand(
      points,
      [{ name: 'Noite', startHour: 22, endHour: 6 }],
      PARAMS,
      2,
    )
    // 8 hours * 2 tickets, both days (the tail of day 2 is inside the window)
    expect(rows.map((r) => r.expected)).toEqual([16, 16])
    expect(rows[0].hours).toBe(8)
  })

  it('skips invalid shifts and drops pre-window tails', () => {
    const points = wfmForecastHours(profile, start, 24, TZ)
    expect(
      wfmShiftDemand(
        points,
        [{ name: 'x', startHour: 5, endHour: 5 }],
        PARAMS,
        1,
      ),
    ).toEqual([])
    const rows = wfmShiftDemand(
      points,
      [{ name: 'Noite', startHour: 22, endHour: 6 }],
      PARAMS,
      1,
    )
    // hours 0-5 of day 0 belong to the previous day (outside); only 22-23 count
    expect(rows[0].expected).toBe(4)
  })
})
