import { describe, expect, it } from 'vitest'
import {
  formatBusinessOpening,
  isWithinBusinessHours,
  nextBusinessOpening,
  type WhatsAppBusinessHours,
} from '@/src/lib/whatsapp/business-hours'

// São Paulo is UTC-3: 11:00Z = 08:00 local. 2026-10-20 is a Tuesday.
const weekdays: WhatsAppBusinessHours = {
  enabled: true,
  start: '08:00',
  end: '18:00',
  days: [1, 2, 3, 4, 5],
}

describe('isWithinBusinessHours()', () => {
  it('should always be open when disabled', () => {
    expect(
      isWithinBusinessHours(
        { ...weekdays, enabled: false },
        new Date('2026-10-25T03:00:00Z'),
      ),
    ).toBe(true)
  })

  it('should follow the start, the end (exclusive) and the weekdays', () => {
    expect(
      isWithinBusinessHours(weekdays, new Date('2026-10-20T11:00:00Z')),
    ).toBe(true)
    expect(
      isWithinBusinessHours(weekdays, new Date('2026-10-20T10:59:00Z')),
    ).toBe(false)
    expect(
      isWithinBusinessHours(weekdays, new Date('2026-10-20T21:00:00Z')),
    ).toBe(false)
    // Saturday 10:00 local
    expect(
      isWithinBusinessHours(weekdays, new Date('2026-10-24T13:00:00Z')),
    ).toBe(false)
  })

  it('should handle an overnight window', () => {
    const night = { enabled: true, start: '22:00', end: '06:00', days: [2] }
    // Tuesday 23:00 local
    expect(isWithinBusinessHours(night, new Date('2026-10-21T02:00:00Z'))).toBe(
      true,
    )
    // Wednesday 05:00 local (tail of Tuesday's window)
    expect(isWithinBusinessHours(night, new Date('2026-10-21T08:00:00Z'))).toBe(
      true,
    )
    // Wednesday 23:00 local
    expect(isWithinBusinessHours(night, new Date('2026-10-22T02:00:00Z'))).toBe(
      false,
    )
  })
})

describe('nextBusinessOpening()', () => {
  it('should return now when already open', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    expect(nextBusinessOpening(weekdays, now)).toEqual(now)
  })

  it('should open later the same day before the start', () => {
    expect(
      nextBusinessOpening(weekdays, new Date('2026-10-20T09:30:00Z')),
    ).toEqual(new Date('2026-10-20T11:00:00Z'))
  })

  it('should skip to the next service day after the end and over the weekend', () => {
    expect(
      nextBusinessOpening(weekdays, new Date('2026-10-20T22:00:00Z')),
    ).toEqual(new Date('2026-10-21T11:00:00Z'))
    // Friday 19:00 local → Monday 08:00 local
    expect(
      nextBusinessOpening(weekdays, new Date('2026-10-23T22:00:00Z')),
    ).toEqual(new Date('2026-10-26T11:00:00Z'))
  })

  it('should never open without weekdays', () => {
    expect(
      nextBusinessOpening(
        { ...weekdays, days: [] },
        new Date('2026-10-20T12:00:00Z'),
      ),
    ).toBeNull()
  })

  it('should format the opening for the agents', () => {
    expect(formatBusinessOpening(new Date('2026-10-26T11:00:00Z'))).toContain(
      '08:00',
    )
  })
})
