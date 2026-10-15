import { describe, expect, it } from 'vitest'
import {
  addDays,
  listDays,
  localDayOf,
  previousRange,
  ratio,
  resolveAnalyticsRange,
  startOfLocalDay,
} from '@/src/lib/sites/analytics'

const SP = 'America/Sao_Paulo'

describe('site analytics calendar', () => {
  it('formats the local day of an instant', () => {
    // 02:00 UTC is still the previous day in São Paulo (UTC-3).
    expect(localDayOf(new Date('2026-10-15T02:00:00Z'), SP)).toBe('2026-10-14')
    expect(localDayOf(new Date('2026-10-15T02:00:00Z'), 'UTC')).toBe(
      '2026-10-15',
    )
  })

  it('adds days and lists ranges', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(listDays('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ])
    expect(listDays('2026-10-03', '2026-10-01')).toEqual([])
  })

  it('finds local midnight in UTC, across DST changes', () => {
    expect(startOfLocalDay('2026-10-15', SP).toISOString()).toBe(
      '2026-10-15T03:00:00.000Z',
    )
    expect(startOfLocalDay('2026-10-15', 'UTC').toISOString()).toBe(
      '2026-10-15T00:00:00.000Z',
    )
    // New York: EDT (UTC-4) in July, EST (UTC-5) in January.
    expect(
      startOfLocalDay('2026-07-01', 'America/New_York').toISOString(),
    ).toBe('2026-07-01T04:00:00.000Z')
    expect(
      startOfLocalDay('2026-01-10', 'America/New_York').toISOString(),
    ).toBe('2026-01-10T05:00:00.000Z')
    // The day DST starts in New York (2026-03-08).
    expect(
      startOfLocalDay('2026-03-09', 'America/New_York').toISOString(),
    ).toBe('2026-03-09T04:00:00.000Z')
  })

  it('resolves the default and explicit ranges and the previous one', () => {
    const now = new Date('2026-10-15T12:00:00Z')
    const range = resolveAnalyticsRange({}, SP, now)
    expect(range.from).toBe('2026-09-16')
    expect(range.to).toBe('2026-10-15')
    expect(range.days).toHaveLength(30)
    expect(range.end.toISOString()).toBe('2026-10-16T03:00:00.000Z')

    const week = resolveAnalyticsRange(
      { from: '2026-10-01', to: '2026-10-07' },
      SP,
      now,
    )
    const before = previousRange(week, SP)
    expect(before.from).toBe('2026-09-24')
    expect(before.to).toBe('2026-09-30')
    expect(before.end).toEqual(week.start)
    expect(before.days).toHaveLength(7)

    expect(resolveAnalyticsRange({ to: '2026-10-10' }, SP, now, 7).from).toBe(
      '2026-10-04',
    )
  })

  it('computes ratios', () => {
    expect(ratio(1, 3)).toBe(0.3333)
    expect(ratio(5, 0)).toBe(0)
  })
})
