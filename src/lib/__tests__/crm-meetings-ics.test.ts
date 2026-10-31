import { describe, expect, it, vi } from 'vitest'
import { buildInvite, parseBusyIntervals } from '../crm-meetings/ics'
import { fetchIcs, normalizeIcsUrl } from '../crm-meetings/ics-fetch'

const range = {
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-12-01T00:00:00Z'),
  timezone: 'America/Sao_Paulo',
}

const wrap = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR\r\n`

const iso = (list: Array<{ start: Date; end: Date }>) =>
  list.map((item) => `${item.start.toISOString()}/${item.end.toISOString()}`)

describe('parseBusyIntervals', () => {
  it('reads UTC, zoned and floating events', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT\r\nDTSTART:20261103T130000Z\r\nDTEND:20261103T140000Z\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART;TZID=America/Sao_Paulo:20261104T100000\r\nDTEND;TZID=America/Sao_Paulo:20261104T110000\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART:20261105T090000\r\nDURATION:PT30M\r\nEND:VEVENT',
      ].join('\r\n'),
    )
    expect(iso(parseBusyIntervals(text, range))).toEqual([
      '2026-11-03T13:00:00.000Z/2026-11-03T14:00:00.000Z',
      '2026-11-04T13:00:00.000Z/2026-11-04T14:00:00.000Z',
      '2026-11-05T12:00:00.000Z/2026-11-05T12:30:00.000Z',
    ])
  })

  it('treats all-day events as busy for the whole day', () => {
    const text = wrap(
      'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111\r\nEND:VEVENT',
    )
    const [day] = parseBusyIntervals(text, range)
    expect(day.end.getTime() - day.start.getTime()).toBe(86400000)
  })

  it('skips cancelled, transparent and out-of-range events', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT\r\nDTSTART:20261103T130000Z\r\nDTEND:20261103T140000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART:20261103T150000Z\r\nDTEND:20261103T160000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART:20250103T150000Z\r\nDTEND:20250103T160000Z\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nSUMMARY:no start\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART:garbage\r\nEND:VEVENT',
      ].join('\r\n'),
    )
    expect(parseBusyIntervals(text, range)).toEqual([])
  })

  it('unfolds long lines', () => {
    const text = wrap(
      'BEGIN:VEVENT\r\nSUMMARY:long\r\n title\r\nDTSTART:20261103T130000Z\r\nDTEND:20261103T140000Z\r\nEND:VEVENT',
    )
    expect(parseBusyIntervals(text, range)).toHaveLength(1)
  })

  it('expands daily and weekly rules, honouring exclusions', () => {
    const daily = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20261102T130000Z\r\nDTEND:20261102T140000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261103T130000Z\r\nEND:VEVENT',
    )
    expect(iso(parseBusyIntervals(daily, range))).toEqual([
      '2026-11-02T13:00:00.000Z/2026-11-02T14:00:00.000Z',
      '2026-11-04T13:00:00.000Z/2026-11-04T14:00:00.000Z',
    ])

    const weekly = wrap(
      'BEGIN:VEVENT\r\nDTSTART;TZID=America/Sao_Paulo:20261102T090000\r\nDTEND;TZID=America/Sao_Paulo:20261102T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261111T000000Z\r\nEND:VEVENT',
    )
    expect(
      iso(parseBusyIntervals(weekly, range)).map((s) => s.slice(0, 10)),
    ).toEqual(['2026-11-02', '2026-11-04', '2026-11-09'])
  })

  it('expands monthly and yearly rules and ignores unknown frequencies', () => {
    const monthly = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20261015T130000Z\r\nDTEND:20261015T140000Z\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nEND:VEVENT',
    )
    expect(iso(parseBusyIntervals(monthly, range))).toEqual([
      '2026-11-15T13:00:00.000Z/2026-11-15T14:00:00.000Z',
    ])
    const yearly = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20251115T130000Z\r\nDTEND:20251115T140000Z\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT',
    )
    expect(iso(parseBusyIntervals(yearly, range))).toEqual([
      '2026-11-15T13:00:00.000Z/2026-11-15T14:00:00.000Z',
    ])
    const hourly = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20261103T130000Z\r\nDTEND:20261103T140000Z\r\nRRULE:FREQ=HOURLY\r\nEND:VEVENT',
    )
    expect(parseBusyIntervals(hourly, range)).toHaveLength(1)
  })

  it('reads events with a duration and ignores zero-length ones', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT\r\nDTSTART:20261103T130000Z\r\nDURATION:P1DT1H\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nDTSTART:20261104T130000Z\r\nEND:VEVENT',
      ].join('\r\n'),
    )
    const [first] = parseBusyIntervals(text, range)
    expect(first.end.getTime() - first.start.getTime()).toBe(25 * 3600000)
  })
})

describe('buildInvite', () => {
  const base = {
    uid: 'b1@steel',
    start: new Date('2026-11-03T13:00:00Z'),
    end: new Date('2026-11-03T13:30:00Z'),
    title: 'Conversa, rápida',
    organizerEmail: 'host@acme.com',
    organizerName: 'Host',
    attendeeEmail: 'guest@x.com',
    attendeeName: 'Guest',
  }

  it('builds a request with escaped text', () => {
    const ics = buildInvite({
      ...base,
      method: 'REQUEST',
      description: 'a;b\nc',
      location: 'https://meet.example/x',
    })
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('DTSTART:20261103T130000Z')
    expect(ics).toContain('SUMMARY:Conversa\\, rápida')
    expect(ics).toContain('DESCRIPTION:a;b\\nc')
    expect(ics).toContain('LOCATION:https://meet.example/x')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('builds a cancellation and folds long lines', () => {
    const ics = buildInvite({
      ...base,
      method: 'CANCEL',
      sequence: 1,
      description: 'x'.repeat(200),
    })
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain('SEQUENCE:1')
    expect(ics.split('\r\n').every((line) => line.length <= 74)).toBe(true)
  })
})

describe('ics fetch', () => {
  it('turns webcal into https', () => {
    expect(normalizeIcsUrl(' webcal://calendar.example/x.ics ')).toBe(
      'https://calendar.example/x.ics',
    )
  })

  it('refuses private hosts and non-https', async () => {
    expect((await fetchIcs('http://calendar.example/x.ics')).ok).toBe(false)
    const result = await fetchIcs('https://127.0.0.1/x.ics', {
      fetchImpl: vi.fn() as never,
    })
    expect(result).toEqual({ ok: false, reason: 'private_host' })
    expect(await fetchIcs('not a url')).toEqual({
      ok: false,
      reason: 'invalid_url',
    })
  })
})
