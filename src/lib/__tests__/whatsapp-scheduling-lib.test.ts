import { describe, expect, it } from 'vitest'
import {
  dueReminder,
  parseAppointmentReply,
} from '../whatsapp/scheduling/replies'
import {
  computeSlots,
  dateKeysFrom,
  hhmmToMinutes,
  isOfferedSlot,
  periodOf,
  windowsOf,
} from '../whatsapp/scheduling/slots'
import {
  addDaysToDateKey,
  formatAppointmentDate,
  isValidTimeZone,
  weekdayOfDateKey,
  zonedDateKey,
  zonedParts,
  zonedToUtc,
} from '../whatsapp/scheduling/time'

const SP = 'America/Sao_Paulo'

describe('scheduling time helpers', () => {
  it('validates zones', () => {
    expect(isValidTimeZone(SP)).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
  })

  it('reads the wall clock of a zone', () => {
    // 2026-11-04T15:30Z is 12:30 in São Paulo (UTC-3), a Wednesday.
    const parts = zonedParts(new Date('2026-11-04T15:30:00Z'), SP)
    expect(parts).toMatchObject({
      year: 2026,
      month: 11,
      day: 4,
      hour: 12,
      minute: 30,
      weekday: 3,
    })
    expect(zonedDateKey(new Date('2026-11-04T01:00:00Z'), SP)).toBe(
      '2026-11-03',
    )
  })

  it('converts a wall clock back to the instant', () => {
    expect(zonedToUtc('2026-11-04', 9 * 60, SP).toISOString()).toBe(
      '2026-11-04T12:00:00.000Z',
    )
    expect(zonedToUtc('2026-11-04', 0, 'UTC').toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    )
  })

  it('does calendar arithmetic on date keys', () => {
    expect(weekdayOfDateKey('2026-11-04')).toBe(3)
    expect(addDaysToDateKey('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('formats the date in pt-BR inside the zone, caching the formatter', () => {
    const a = formatAppointmentDate(new Date('2026-11-04T17:30:00Z'), SP)
    const b = formatAppointmentDate(new Date('2026-11-04T17:30:00Z'), SP)
    expect(a).toBe(b)
    expect(a).toContain('04/11')
    expect(a).toContain('14:30')
  })
})

describe('slots', () => {
  const hours = {
    '3': [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '16:00' },
    ],
    '4': [{ start: '25:00', end: '26:00' }],
    '5': [{ start: '10:00', end: '09:00' }],
  }
  const base = {
    dateKey: '2026-11-04',
    timeZone: SP,
    hours,
    durationMinutes: 60,
    bufferMinutes: 0,
    stepMinutes: 60,
    busy: [],
    now: new Date('2026-11-01T00:00:00Z'),
    minNoticeMinutes: 0,
  }
  const hhmm = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: SP,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)

  it('parses hours and drops malformed windows', () => {
    expect(hhmmToMinutes('09:30')).toBe(570)
    expect(windowsOf(hours, 3)).toHaveLength(2)
    expect(windowsOf(hours, 4)).toEqual([])
    expect(windowsOf(hours, 5)).toEqual([])
    expect(windowsOf(hours, 0)).toEqual([])
    expect(windowsOf({ '1': 'x' as never }, 1)).toEqual([])
  })

  it('offers every start that fits the windows', () => {
    expect(computeSlots(base).map(hhmm)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '14:00',
      '15:00',
    ])
  })

  it('returns nothing on a day off', () => {
    expect(computeSlots({ ...base, dateKey: '2026-11-08' })).toEqual([])
  })

  it('removes starts that clash with a busy range', () => {
    const busy = [
      {
        startsAt: new Date('2026-11-04T13:00:00Z'),
        endsAt: new Date('2026-11-04T14:00:00Z'),
      },
    ]
    expect(computeSlots({ ...base, busy }).map(hhmm)).toEqual([
      '09:00',
      '11:00',
      '14:00',
      '15:00',
    ])
  })

  it('counts the buffer after the appointment', () => {
    // 60 min + 30 min buffer: the 10:00 start would run into the 11:00 busy.
    const busy = [
      {
        startsAt: new Date('2026-11-04T14:00:00Z'),
        endsAt: new Date('2026-11-04T15:00:00Z'),
      },
    ]
    const slots = computeSlots({
      ...base,
      bufferMinutes: 30,
      busy,
      stepMinutes: 30,
    })
    expect(slots.map(hhmm)).not.toContain('10:00')
    expect(slots.map(hhmm)).toContain('09:00')
  })

  it('respects the minimum notice', () => {
    const now = new Date('2026-11-04T12:30:00Z') // 09:30 in São Paulo
    expect(
      computeSlots({ ...base, now, minNoticeMinutes: 60 }).map(hhmm),
    ).toEqual(['11:00', '14:00', '15:00'])
  })

  it('checks whether a start is offered', () => {
    const { dateKey: _ignored, ...input } = base
    expect(isOfferedSlot(input, new Date('2026-11-04T12:00:00Z'))).toBe(true)
    expect(isOfferedSlot(input, new Date('2026-11-04T12:15:00Z'))).toBe(false)
  })

  it('lists consecutive date keys and classifies the period', () => {
    expect(dateKeysFrom('2026-11-30', 3)).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ])
    expect(periodOf(new Date('2026-11-04T14:59:00Z'), SP)).toBe('manha')
    expect(periodOf(new Date('2026-11-04T15:00:00Z'), SP)).toBe('tarde')
  })
})

describe('appointment replies', () => {
  it.each([
    ['CONFIRMAR', 'CONFIRM'],
    [' Sim! ', 'CONFIRM'],
    ['1', 'CONFIRM'],
    ['cancelar', 'CANCEL'],
    ['Não', 'CANCEL'],
    ['2', 'CANCEL'],
  ])('reads %s', (text, expected) => {
    expect(parseAppointmentReply(text)).toBe(expected)
  })

  it('ignores sentences and empty text', () => {
    expect(parseAppointmentReply('não posso ir amanhã')).toBeNull()
    expect(parseAppointmentReply('')).toBeNull()
    expect(parseAppointmentReply(null)).toBeNull()
  })

  describe('dueReminder', () => {
    const startsAt = new Date('2026-11-05T12:00:00Z')

    it('sends the tightest due offset and marks the wider ones', () => {
      expect(
        dueReminder({
          startsAt,
          now: new Date('2026-11-05T09:00:00Z'), // 3 h before
          offsets: [1440, 120],
          sent: [],
        }),
      ).toEqual({ send: 1440, markSent: [1440] })
      expect(
        dueReminder({
          startsAt,
          now: new Date('2026-11-05T10:30:00Z'), // 1.5 h before
          offsets: [1440, 120],
          sent: [],
        }),
      ).toEqual({ send: 120, markSent: [120, 1440] })
    })

    it('does not repeat or fire after the start', () => {
      expect(
        dueReminder({
          startsAt,
          now: new Date('2026-11-05T11:00:00Z'),
          offsets: [120],
          sent: [120],
        }),
      ).toBeNull()
      expect(
        dueReminder({
          startsAt,
          now: new Date('2026-11-05T12:01:00Z'),
          offsets: [120],
          sent: [],
        }),
      ).toBeNull()
    })
  })
})
