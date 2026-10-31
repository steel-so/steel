import { describe, expect, it } from 'vitest'
import {
  collides,
  computeFreeSlots,
  DEFAULT_WEEKLY_HOURS,
  type SlotRules,
  windowsOf,
} from '../crm-meetings/slots'
import {
  isValidTimezone,
  localDateKey,
  localParts,
  parseClock,
  zonedTimeToUtc,
} from '../crm-meetings/tz'

describe('tz helpers', () => {
  it('validates zones', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
  })

  it('reads wall-clock parts of an instant', () => {
    // 2026-11-02 (Monday) 15:30 UTC is 12:30 in São Paulo (UTC-3).
    const parts = localParts(
      new Date('2026-11-02T15:30:00Z'),
      'America/Sao_Paulo',
    )
    expect(parts).toMatchObject({
      year: 2026,
      month: 11,
      day: 2,
      hour: 12,
      minute: 30,
      weekday: 1,
    })
  })

  it('converts a wall-clock time back to the instant', () => {
    const date = zonedTimeToUtc(
      { year: 2026, month: 11, day: 2, hour: 9, minute: 0 },
      'America/Sao_Paulo',
    )
    expect(date.toISOString()).toBe('2026-11-02T12:00:00.000Z')
  })

  it('handles zones with daylight saving', () => {
    const winter = zonedTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
      'America/New_York',
    )
    const summer = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      'America/New_York',
    )
    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z')
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z')
  })

  it('formats the local date key and parses clocks', () => {
    expect(
      localDateKey(new Date('2026-11-02T01:00:00Z'), 'America/Sao_Paulo'),
    ).toBe('2026-11-01')
    expect(parseClock('09:30')).toBe(570)
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('9h')).toBeNull()
  })
})

const NOW = new Date('2026-11-02T12:00:00Z') // Monday 09:00 in São Paulo

function rules(over: Partial<SlotRules> = {}): SlotRules {
  return {
    from: NOW,
    to: new Date(NOW.getTime() + 7 * 86400000),
    now: NOW,
    durationMinutes: 60,
    bufferMinutes: 0,
    stepMinutes: 60,
    minNoticeMinutes: 0,
    maxDaysAhead: 30,
    timezone: 'America/Sao_Paulo',
    weeklyHours: {
      '1': [{ start: '09:00', end: '12:00' }],
      '3': [{ start: '14:00', end: '16:00' }],
    },
    busy: [],
    ...over,
  }
}

const iso = (slots: Date[]) => slots.map((slot) => slot.toISOString())

describe('windowsOf', () => {
  it('drops malformed and inverted windows and sorts', () => {
    expect(
      windowsOf(
        {
          '2': [
            { start: '14:00', end: '15:00' },
            { start: '09:00', end: '08:00' },
            { start: 'x', end: '10:00' },
            { start: '08:00', end: '09:00' },
          ],
        },
        2,
      ),
    ).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 840, endMin: 900 },
    ])
    expect(windowsOf({}, 3)).toEqual([])
  })
})

describe('collides', () => {
  it('counts the buffer on both sides', () => {
    const busy = [
      {
        start: new Date('2026-11-02T13:00:00Z'),
        end: new Date('2026-11-02T14:00:00Z'),
      },
    ]
    expect(
      collides(
        new Date('2026-11-02T14:00:00Z'),
        new Date('2026-11-02T15:00:00Z'),
        busy,
        0,
      ),
    ).toBe(false)
    expect(
      collides(
        new Date('2026-11-02T14:00:00Z'),
        new Date('2026-11-02T15:00:00Z'),
        busy,
        15,
      ),
    ).toBe(true)
    expect(
      collides(
        new Date('2026-11-02T12:00:00Z'),
        new Date('2026-11-02T13:30:00Z'),
        busy,
        0,
      ),
    ).toBe(true)
  })
})

describe('computeFreeSlots', () => {
  it('lists the working windows in the seller zone', () => {
    const slots = computeFreeSlots(rules())
    // Monday 09-12 -> 12:00, 13:00, 14:00 UTC; Wednesday 14-16 -> 17:00, 18:00 UTC.
    expect(iso(slots)).toEqual([
      '2026-11-02T12:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-04T17:00:00.000Z',
      '2026-11-04T18:00:00.000Z',
    ])
  })

  it('respects the minimum notice', () => {
    const slots = computeFreeSlots(rules({ minNoticeMinutes: 90 }))
    // 12:00Z + 90 min = 13:30Z, so the first hourly slot is 14:00Z.
    expect(iso(slots)[0]).toBe('2026-11-02T14:00:00.000Z')
  })

  it('removes slots that collide with busy time and buffer', () => {
    const busy = [
      {
        start: new Date('2026-11-02T13:00:00Z'),
        end: new Date('2026-11-02T14:00:00Z'),
      },
    ]
    expect(iso(computeFreeSlots(rules({ busy })))).not.toContain(
      '2026-11-02T13:00:00.000Z',
    )
    const buffered = iso(computeFreeSlots(rules({ busy, bufferMinutes: 30 })))
    expect(buffered).not.toContain('2026-11-02T12:00:00.000Z')
    expect(buffered).not.toContain('2026-11-02T14:00:00.000Z')
  })

  it('stops at the booking horizon', () => {
    const slots = computeFreeSlots(rules({ maxDaysAhead: 1 }))
    expect(iso(slots).every((slot) => slot < '2026-11-03T12:00:00.000Z')).toBe(
      true,
    )
  })

  it('steps by the configured interval', () => {
    const slots = computeFreeSlots(
      rules({
        durationMinutes: 30,
        stepMinutes: 30,
        weeklyHours: { '1': [{ start: '09:00', end: '10:00' }] },
      }),
    )
    expect(iso(slots)).toEqual([
      '2026-11-02T12:00:00.000Z',
      '2026-11-02T12:30:00.000Z',
    ])
  })

  it('returns nothing for an empty or inverted window', () => {
    expect(computeFreeSlots(rules({ weeklyHours: {} }))).toEqual([])
    expect(computeFreeSlots(rules({ from: NOW, to: NOW }))).toEqual([])
  })

  it('uses the zone of the seller, not the server', () => {
    const slots = computeFreeSlots(
      rules({
        timezone: 'America/Manaus',
        weeklyHours: { '1': [{ start: '09:00', end: '10:00' }] },
      }),
    )
    expect(iso(slots)).toEqual(['2026-11-02T13:00:00.000Z'])
  })

  it('ships a Monday-to-Friday default', () => {
    expect(Object.keys(DEFAULT_WEEKLY_HOURS)).toEqual(['1', '2', '3', '4', '5'])
  })
})
