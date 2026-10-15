import { describe, expect, it } from 'vitest'
import {
  businessDayProgress,
  businessDaysBetween,
  DEFAULT_SALES_TIME_ZONE,
  daysBetween,
  dayWindow,
  holidaySet,
  isBusinessDay,
  salesWindow,
  weekDays,
} from '@/src/lib/crm-sales/period'

const SP = DEFAULT_SALES_TIME_ZONE

describe('salesWindow()', () => {
  it('returns the civil month of São Paulo, not of UTC', () => {
    // 31/10 23:00 in São Paulo is already 01/11 in UTC.
    const window = salesWindow(new Date('2026-11-01T02:00:00.000Z'), SP, 'month')
    expect(window.key).toBe('2026-10')
    expect(window.fromKey).toBe('2026-10-01')
    expect(window.toKey).toBe('2026-10-31')
    expect(window.start.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-11-01T03:00:00.000Z')
    expect(window.label).toBe('outubro de 2026')
  })

  it('shifts by whole months across the year boundary', () => {
    const january = salesWindow(new Date('2026-01-10T12:00:00.000Z'), SP, 'month', -1)
    expect(january.key).toBe('2025-12')
    expect(january.toKey).toBe('2025-12-31')
  })

  it('ends February on the 28th or 29th', () => {
    expect(salesWindow(new Date('2028-02-10T12:00:00.000Z'), SP, 'month').toKey).toBe(
      '2028-02-29',
    )
    expect(salesWindow(new Date('2026-02-10T12:00:00.000Z'), SP, 'month').toKey).toBe(
      '2026-02-28',
    )
  })

  it('builds quarters with the CrmQuota key format', () => {
    const q4 = salesWindow(new Date('2026-11-20T12:00:00.000Z'), SP, 'quarter')
    expect(q4).toMatchObject({
      key: '2026-Q4',
      fromKey: '2026-10-01',
      toKey: '2026-12-31',
      label: '4º trimestre de 2026',
    })
    const previous = salesWindow(new Date('2026-02-01T12:00:00.000Z'), SP, 'quarter', -1)
    expect(previous.key).toBe('2025-Q4')
    expect(previous.fromKey).toBe('2025-10-01')
  })

  it('follows another time zone when the workspace has one', () => {
    const tokyo = salesWindow(new Date('2026-09-30T16:00:00.000Z'), 'Asia/Tokyo', 'month')
    expect(tokyo.key).toBe('2026-10')
  })
})

describe('business days', () => {
  it('skips weekends and holidays', () => {
    expect(isBusinessDay('2026-10-17', new Set())).toBe(false) // Saturday
    expect(isBusinessDay('2026-10-18', new Set())).toBe(false) // Sunday
    expect(isBusinessDay('2026-10-12', new Set())).toBe(true)
    expect(isBusinessDay('2026-10-12', new Set(['2026-10-12']))).toBe(false)
  })

  it('counts the business days of October 2026', () => {
    expect(businessDaysBetween('2026-10-01', '2026-10-31', new Set())).toBe(22)
    expect(
      businessDaysBetween('2026-10-01', '2026-10-31', new Set(['2026-10-12'])),
    ).toBe(21)
    expect(businessDaysBetween('2026-10-31', '2026-10-01', new Set())).toBe(0)
  })

  it('counts today both as elapsed and as left', () => {
    const window = { fromKey: '2026-10-01', toKey: '2026-10-31' }
    expect(businessDayProgress(window, '2026-10-15', new Set())).toEqual({
      total: 22,
      elapsed: 11,
      left: 12,
    })
  })

  it('handles a today before or after the window', () => {
    const window = { fromKey: '2026-10-01', toKey: '2026-10-31' }
    expect(businessDayProgress(window, '2026-09-30', new Set())).toEqual({
      total: 22,
      elapsed: 0,
      left: 22,
    })
    expect(businessDayProgress(window, '2026-11-02', new Set())).toEqual({
      total: 22,
      elapsed: 22,
      left: 0,
    })
  })

  it('has no elapsed business day on a month that starts on a weekend', () => {
    const window = { fromKey: '2026-08-01', toKey: '2026-08-31' }
    expect(businessDayProgress(window, '2026-08-01', new Set()).elapsed).toBe(0)
  })
})

describe('day helpers', () => {
  it('daysBetween counts civil days with sign', () => {
    expect(daysBetween('2026-10-15', '2026-10-18')).toBe(3)
    expect(daysBetween('2026-10-15', '2026-10-14')).toBe(-1)
  })

  it('dayWindow is the local day', () => {
    const day = dayWindow(new Date('2026-10-16T01:30:00.000Z'), SP)
    expect(day.key).toBe('2026-10-15')
    expect(day.start.toISOString()).toBe('2026-10-15T03:00:00.000Z')
    expect(day.end.toISOString()).toBe('2026-10-16T03:00:00.000Z')
  })

  it('weekDays runs from Monday to Sunday', () => {
    expect(weekDays(new Date('2026-10-15T15:00:00.000Z'), SP)).toEqual({
      fromKey: '2026-10-12',
      toKey: '2026-10-18',
    })
    // Sunday belongs to the week that started on the previous Monday.
    expect(weekDays(new Date('2026-10-18T15:00:00.000Z'), SP).fromKey).toBe(
      '2026-10-12',
    )
  })

  it('holidaySet keeps only well-formed dates', () => {
    expect(
      holidaySet([
        { date: '2026-12-25', name: 'Natal' },
        { date: '25/12/2026' },
        { name: 'sem data' },
        null,
        'texto',
      ]),
    ).toEqual(new Set(['2026-12-25']))
    expect(holidaySet(null)).toEqual(new Set())
  })
})
