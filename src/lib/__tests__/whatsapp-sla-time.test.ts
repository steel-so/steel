import { describe, expect, it } from 'vitest'
import type { WhatsAppBusinessHours } from '@/src/lib/whatsapp/business-hours'
import {
  addBusinessMinutes,
  businessMillisBetween,
  computeSlaDeadlines,
  slaTargetState,
  worstSlaState,
} from '@/src/lib/whatsapp/sla-time'

// America/Sao_Paulo is UTC-3 (no DST): 08:00 local = 11:00Z.
const weekdays: WhatsAppBusinessHours = {
  enabled: true,
  start: '08:00',
  end: '18:00',
  days: [1, 2, 3, 4, 5],
}
const nightShift: WhatsAppBusinessHours = {
  enabled: true,
  start: '22:00',
  end: '06:00',
  days: [1, 2, 3, 4, 5],
}
const iso = (date: Date | null | undefined) => date?.toISOString()

describe('addBusinessMinutes()', () => {
  it('should add plain wall time while the hours are disabled', () => {
    const off = { ...weekdays, enabled: false }
    expect(
      iso(addBusinessMinutes(off, new Date('2026-10-24T03:00:00Z'), 90)),
    ).toBe('2026-10-24T04:30:00.000Z')
  })

  it('should count inside the window when the cycle starts inside it', () => {
    // Wed 10:00 local + 30 min
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-21T13:00:00Z'), 30)),
    ).toBe('2026-10-21T13:30:00.000Z')
  })

  it('should carry the remainder to the next day when the window closes', () => {
    // Fri 17:50 local + 30 min -> 10 min Friday, 20 min Monday 08:20
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-23T20:50:00Z'), 30)),
    ).toBe('2026-10-26T11:20:00.000Z')
  })

  it('should start the clock at the next opening when the cycle starts outside the hours', () => {
    // Sat 12:00 local + 15 min -> Mon 08:15
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-24T15:00:00Z'), 15)),
    ).toBe('2026-10-26T11:15:00.000Z')
  })

  it('should land exactly on the closing time when the span fits the window', () => {
    // Wed 17:00 local + 60 min -> 18:00
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-21T20:00:00Z'), 60)),
    ).toBe('2026-10-21T21:00:00.000Z')
  })

  it('should span several days for a long target', () => {
    // Mon 08:00 local + 25 h of open time (10 h/day) -> Wed 13:00
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-26T11:00:00Z'), 1500)),
    ).toBe('2026-10-28T16:00:00.000Z')
  })

  it('should keep counting in the tail of Friday night on Saturday morning', () => {
    // Sat 04:00 local is still Friday's window -> +60 min = Sat 05:00
    expect(
      iso(addBusinessMinutes(nightShift, new Date('2026-10-24T07:00:00Z'), 60)),
    ).toBe('2026-10-24T08:00:00.000Z')
  })

  it('should handle an overnight window running into a non-service day', () => {
    // Fri 23:00 local (service day) + 120 min -> Sat 01:00 (tail of Friday)
    expect(
      iso(
        addBusinessMinutes(nightShift, new Date('2026-10-24T02:00:00Z'), 120),
      ),
    ).toBe('2026-10-24T04:00:00.000Z')
  })

  it('should jump over the gap between overnight windows', () => {
    // Sat 10:00 local is outside and Sat evening is not a service day:
    // the clock starts Mon 22:00 local, +60 min = Mon 23:00 local
    expect(
      iso(addBusinessMinutes(nightShift, new Date('2026-10-24T13:00:00Z'), 60)),
    ).toBe('2026-10-27T02:00:00.000Z')
  })

  it('should treat start == end as a whole service day and chain adjacent days', () => {
    const wholeDay = { ...weekdays, start: '00:00', end: '00:00' }
    // Thu 23:30 local + 60 min -> Fri 00:30
    expect(
      iso(addBusinessMinutes(wholeDay, new Date('2026-10-23T02:30:00Z'), 60)),
    ).toBe('2026-10-23T03:30:00.000Z')
  })

  it('should keep the seconds of the start instant', () => {
    expect(
      iso(addBusinessMinutes(weekdays, new Date('2026-10-21T13:00:30Z'), 10)),
    ).toBe('2026-10-21T13:10:30.000Z')
  })

  it('should return null when no weekday is selected', () => {
    expect(
      addBusinessMinutes(
        { ...weekdays, days: [] },
        new Date('2026-10-21T13:00:00Z'),
        10,
      ),
    ).toBeNull()
  })
})

describe('businessMillisBetween()', () => {
  const minute = 60 * 1000

  it('should be zero when the span is empty or reversed', () => {
    const at = new Date('2026-10-21T13:00:00Z')
    expect(businessMillisBetween(weekdays, at, at)).toBe(0)
    expect(
      businessMillisBetween(weekdays, at, new Date('2026-10-21T12:00:00Z')),
    ).toBe(0)
  })

  it('should be plain elapsed time while the hours are disabled', () => {
    const off = { ...weekdays, enabled: false }
    expect(
      businessMillisBetween(
        off,
        new Date('2026-10-24T10:00:00Z'),
        new Date('2026-10-24T11:00:00Z'),
      ),
    ).toBe(60 * minute)
  })

  it('should skip the night and the weekend', () => {
    // Fri 17:50 local -> Mon 08:20 local = 10 + 20 open minutes
    expect(
      businessMillisBetween(
        weekdays,
        new Date('2026-10-23T20:50:00Z'),
        new Date('2026-10-26T11:20:00Z'),
      ),
    ).toBe(30 * minute)
  })

  it('should count only the open part when the span starts outside the hours', () => {
    // Sat -> Mon 09:00 local = 60 open minutes
    expect(
      businessMillisBetween(
        weekdays,
        new Date('2026-10-24T15:00:00Z'),
        new Date('2026-10-26T12:00:00Z'),
      ),
    ).toBe(60 * minute)
  })

  it('should be the inverse of addBusinessMinutes()', () => {
    const from = new Date('2026-10-22T19:40:00Z')
    const due = addBusinessMinutes(weekdays, from, 95)
    expect(due).not.toBeNull()
    expect(businessMillisBetween(weekdays, from, due as Date)).toBe(95 * minute)
  })

  it('should return zero when the hours never open', () => {
    expect(
      businessMillisBetween(
        { ...weekdays, days: [] },
        new Date('2026-10-21T13:00:00Z'),
        new Date('2026-10-22T13:00:00Z'),
      ),
    ).toBe(0)
  })
})

describe('computeSlaDeadlines()', () => {
  const startedAt = new Date('2026-10-21T13:00:00Z')

  it('should compute wall-clock deadlines and the warning point', () => {
    const result = computeSlaDeadlines(
      weekdays,
      {
        firstResponseMinutes: 10,
        resolutionMinutes: 100,
        warnAtPercent: 80,
        businessHoursOnly: false,
      },
      startedAt,
    )
    expect(iso(result?.firstResponseDueAt)).toBe('2026-10-21T13:10:00.000Z')
    expect(iso(result?.firstResponseWarnAt)).toBe('2026-10-21T13:08:00.000Z')
    expect(iso(result?.resolutionDueAt)).toBe('2026-10-21T14:40:00.000Z')
    expect(iso(result?.resolutionWarnAt)).toBe('2026-10-21T14:20:00.000Z')
  })

  it('should apply the business hours to every deadline', () => {
    const result = computeSlaDeadlines(
      weekdays,
      {
        firstResponseMinutes: 60,
        resolutionMinutes: null,
        warnAtPercent: 50,
        businessHoursOnly: true,
      },
      new Date('2026-10-23T20:30:00Z'), // Fri 17:30 local
    )
    expect(iso(result?.firstResponseWarnAt)).toBe('2026-10-23T21:00:00.000Z')
    expect(iso(result?.firstResponseDueAt)).toBe('2026-10-26T11:30:00.000Z')
    expect(result?.resolutionDueAt).toBeNull()
    expect(result?.resolutionWarnAt).toBeNull()
  })

  it('should warn at least one minute in', () => {
    const result = computeSlaDeadlines(
      weekdays,
      {
        firstResponseMinutes: 1,
        resolutionMinutes: null,
        warnAtPercent: 10,
        businessHoursOnly: false,
      },
      startedAt,
    )
    expect(iso(result?.firstResponseWarnAt)).toBe('2026-10-21T13:01:00.000Z')
  })

  it('should return null when business hours can never be met', () => {
    const never = { ...weekdays, days: [] }
    expect(
      computeSlaDeadlines(
        never,
        {
          firstResponseMinutes: 10,
          resolutionMinutes: null,
          warnAtPercent: 80,
          businessHoursOnly: true,
        },
        startedAt,
      ),
    ).toBeNull()
    expect(
      computeSlaDeadlines(
        never,
        {
          firstResponseMinutes: 10,
          resolutionMinutes: 20,
          warnAtPercent: 80,
          businessHoursOnly: false,
        },
        startedAt,
      ),
    ).not.toBeNull()
  })
})

describe('slaTargetState() and worstSlaState()', () => {
  const target = {
    warnAt: new Date('2026-10-21T13:08:00Z'),
    dueAt: new Date('2026-10-21T13:10:00Z'),
  }

  it('should walk OK -> AT_RISK -> BREACHED', () => {
    expect(slaTargetState(target, new Date('2026-10-21T13:07:59Z'))).toBe('OK')
    expect(slaTargetState(target, new Date('2026-10-21T13:08:00Z'))).toBe(
      'AT_RISK',
    )
    expect(slaTargetState(target, new Date('2026-10-21T13:10:00Z'))).toBe(
      'BREACHED',
    )
  })

  it('should pick the worst of two states', () => {
    expect(worstSlaState('OK', 'AT_RISK')).toBe('AT_RISK')
    expect(worstSlaState('BREACHED', 'AT_RISK')).toBe('BREACHED')
    expect(worstSlaState('OK', 'OK')).toBe('OK')
  })
})
