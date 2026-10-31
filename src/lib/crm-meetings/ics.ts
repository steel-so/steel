import type { Interval } from './slots'
import { localParts, zonedTimeToUtc } from './tz'

/**
 * Minimal iCalendar (RFC 5545) reader and writer for the meeting scheduler.
 *
 * Reading: only what "is this person busy?" needs, from the secret iCal
 * address Google Calendar and Outlook give for a calendar. Events with
 * `TRANSP:TRANSPARENT` or `STATUS:CANCELLED` are free time; `RRULE` covers
 * DAILY / WEEKLY (with BYDAY) / MONTHLY / YEARLY with INTERVAL, COUNT and
 * UNTIL; `EXDATE` is honoured. Anything fancier is read as a single event.
 *
 * Writing: a REQUEST/CANCEL invitation attached to the confirmation e-mail.
 */

const MAX_OCCURRENCES = 2000
const DAY_MS = 24 * 60 * 60 * 1000

interface Property {
  name: string
  params: Record<string, string>
  value: string
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/)
}

function parseLine(line: string): Property | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const raw of head.slice(1)) {
    const eq = raw.indexOf('=')
    if (eq > 0)
      params[raw.slice(0, eq).toUpperCase()] = raw
        .slice(eq + 1)
        .replace(/"/g, '')
  }
  return {
    name: (head[0] ?? '').toUpperCase(),
    params,
    value: line.slice(colon + 1).trim(),
  }
}

interface Moment {
  date: Date
  allDay: boolean
}

function parseMoment(prop: Property, fallbackTimezone: string): Moment | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    prop.value,
  )
  if (!m) return null
  const [, y, mo, d, h, mi, , z] = m
  const fields = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
  }
  const allDay = prop.params.VALUE === 'DATE' || h === undefined
  if (z) {
    return {
      date: new Date(
        Date.UTC(
          fields.year,
          fields.month - 1,
          fields.day,
          fields.hour,
          fields.minute,
        ),
      ),
      allDay,
    }
  }
  const timezone = prop.params.TZID ?? fallbackTimezone
  try {
    return { date: zonedTimeToUtc(fields, timezone), allDay }
  } catch {
    return { date: zonedTimeToUtc(fields, fallbackTimezone), allDay }
  }
}

function parseDuration(value: string): number | null {
  const m =
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value,
    )
  if (!m) return null
  const [, w, d, h, mi, s] = m
  return (
    (Number(w ?? 0) * 7 + Number(d ?? 0)) * DAY_MS +
    Number(h ?? 0) * 3600000 +
    Number(mi ?? 0) * 60000 +
    Number(s ?? 0) * 1000
  )
}

const BYDAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  until: Date | null
  byDay: number[]
}

function parseRule(value: string, fallbackTimezone: string): Rule | null {
  const map = new Map<string, string>()
  for (const part of value.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) map.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1))
  }
  const freq = map.get('FREQ')
  if (
    freq !== 'DAILY' &&
    freq !== 'WEEKLY' &&
    freq !== 'MONTHLY' &&
    freq !== 'YEARLY'
  )
    return null
  const untilRaw = map.get('UNTIL')
  const until = untilRaw
    ? (parseMoment(
        { name: 'UNTIL', params: {}, value: untilRaw },
        fallbackTimezone,
      )?.date ?? null)
    : null
  const byDay = (map.get('BYDAY') ?? '')
    .split(',')
    .map((token) => BYDAY[token.replace(/^[+-]?\d+/, '')])
    .filter((n): n is number => n !== undefined)
  return {
    freq,
    interval: Math.max(1, Number(map.get('INTERVAL') ?? 1) || 1),
    count: map.get('COUNT') ? Number(map.get('COUNT')) : null,
    until,
    byDay,
  }
}

/** Start instants of a recurring event inside `[from, to)`. */
function expand(
  first: Date,
  rule: Rule,
  timezone: string,
  from: Date,
  to: Date,
  durationMs: number,
): Date[] {
  const out: Date[] = []
  const parts = localParts(first, timezone)
  const wall = { hour: parts.hour, minute: parts.minute }
  const at = (year: number, month: number, day: number) =>
    zonedTimeToUtc({ year, month, day, ...wall }, timezone)
  let produced = 0
  const limit = rule.until?.getTime() ?? Number.POSITIVE_INFINITY

  const push = (instant: Date): boolean => {
    if (instant.getTime() > limit || instant.getTime() >= to.getTime())
      return false
    if (rule.count !== null && produced >= rule.count) return false
    if (instant.getTime() >= first.getTime()) {
      produced += 1
      if (instant.getTime() + durationMs > from.getTime()) out.push(instant)
    }
    return out.length < MAX_OCCURRENCES
  }

  if (rule.freq === 'DAILY') {
    for (let i = 0; ; i++) {
      const base = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day + i * rule.interval),
      )
      if (
        !push(
          at(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()),
        )
      )
        break
    }
  } else if (rule.freq === 'WEEKLY') {
    const days =
      rule.byDay.length > 0 ? [...rule.byDay].sort() : [parts.weekday]
    for (let week = 0; ; week++) {
      let stop = false
      for (const weekday of days) {
        const base = new Date(
          Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day + week * 7 * rule.interval + (weekday - parts.weekday),
          ),
        )
        if (
          !push(
            at(
              base.getUTCFullYear(),
              base.getUTCMonth() + 1,
              base.getUTCDate(),
            ),
          )
        )
          stop = true
      }
      if (stop) break
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let i = 0; ; i++) {
      const base = new Date(
        Date.UTC(parts.year, parts.month - 1 + i * rule.interval, parts.day),
      )
      if (base.getUTCDate() !== parts.day) continue
      if (
        !push(
          at(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()),
        )
      )
        break
    }
  } else {
    for (let i = 0; ; i++) {
      if (!push(at(parts.year + i * rule.interval, parts.month, parts.day)))
        break
    }
  }
  return out
}

/** Busy intervals of an iCalendar feed that touch `[from, to)`. */
export function parseBusyIntervals(
  text: string,
  options: { from: Date; to: Date; timezone: string },
): Interval[] {
  const lines = unfold(text)
  const busy: Interval[] = []
  let current: Property[] | null = null

  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      current = []
      continue
    }
    if (upper === 'END:VEVENT' && current) {
      const events = eventToIntervals(current, options)
      for (const event of events) busy.push(event)
      current = null
      continue
    }
    if (current) {
      const prop = parseLine(line)
      if (prop) current.push(prop)
    }
  }
  return busy
}

function eventToIntervals(
  props: Property[],
  options: { from: Date; to: Date; timezone: string },
): Interval[] {
  const find = (name: string) => props.find((prop) => prop.name === name)
  if (find('STATUS')?.value.toUpperCase() === 'CANCELLED') return []
  if (find('TRANSP')?.value.toUpperCase() === 'TRANSPARENT') return []

  const startProp = find('DTSTART')
  if (!startProp) return []
  const start = parseMoment(startProp, options.timezone)
  if (!start) return []

  const endProp = find('DTEND')
  const end = endProp ? parseMoment(endProp, options.timezone) : null
  const durationProp = find('DURATION')
  let durationMs: number
  if (end) durationMs = end.date.getTime() - start.date.getTime()
  else if (durationProp) durationMs = parseDuration(durationProp.value) ?? 0
  else durationMs = start.allDay ? DAY_MS : 0
  if (durationMs <= 0) durationMs = start.allDay ? DAY_MS : 0
  if (durationMs === 0) return []

  const exdates = new Set<number>()
  for (const prop of props.filter((p) => p.name === 'EXDATE')) {
    for (const value of prop.value.split(',')) {
      const moment = parseMoment({ ...prop, value }, options.timezone)
      if (moment) exdates.add(moment.date.getTime())
    }
  }

  const ruleProp = find('RRULE')
  const rule = ruleProp ? parseRule(ruleProp.value, options.timezone) : null
  const starts = rule
    ? expand(
        start.date,
        rule,
        options.timezone,
        options.from,
        options.to,
        durationMs,
      )
    : [start.date]

  const intervals: Interval[] = []
  for (const begin of starts) {
    if (exdates.has(begin.getTime())) continue
    const finish = new Date(begin.getTime() + durationMs)
    if (
      finish.getTime() > options.from.getTime() &&
      begin.getTime() < options.to.getTime()
    ) {
      intervals.push({ start: begin, end: finish })
    }
  }
  return intervals
}

// ─── Writing ────────────────────────────────────────────────────────────────

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function fold(line: string): string {
  if (line.length <= 73) return line
  const chunks: string[] = []
  for (let i = 0; i < line.length; i += 73) chunks.push(line.slice(i, i + 73))
  return chunks.join('\r\n ')
}

export interface InviteInput {
  uid: string
  start: Date
  end: Date
  title: string
  description?: string | null
  location?: string | null
  organizerEmail: string
  organizerName: string
  attendeeEmail: string
  attendeeName: string
  method: 'REQUEST' | 'CANCEL'
  sequence?: number
}

/** A single-event `.ics` the guest can add to any calendar. */
export function buildInvite(input: InviteInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Steel//Meetings//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `SUMMARY:${escapeText(input.title)}`,
    `STATUS:${input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${escapeText(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${escapeText(input.attendeeName)};RSVP=FALSE:mailto:${input.attendeeEmail}`,
  ]
  if (input.description)
    lines.push(`DESCRIPTION:${escapeText(input.description)}`)
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
