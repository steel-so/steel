/**
 * Time-zone helpers of the meeting scheduler (C5). Everything is built on
 * `Intl`, so no date library is needed and the result never depends on the
 * server's own zone (CI runs in UTC).
 */

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = Sunday. */
  weekday: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timezone)
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(timezone, cached)
  }
  return cached
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** The wall-clock fields of an instant in a zone. */
export function localParts(date: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '0'
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  }
}

/** Offset (ms) of the zone from UTC at an instant. */
function offsetAt(instant: number, timezone: string): number {
  const p = localParts(new Date(instant), timezone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0)
  return asUtc - Math.floor(instant / 60000) * 60000
}

/** The instant a wall-clock time happens in a zone (DST gaps move forward). */
export function zonedTimeToUtc(
  fields: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
  timezone: string,
): Date {
  const wall = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    0,
  )
  let guess = wall - offsetAt(wall, timezone)
  guess = wall - offsetAt(guess, timezone)
  return new Date(guess)
}

/** `YYYY-MM-DD` of an instant in a zone. */
export function localDateKey(date: Date, timezone: string): string {
  const p = localParts(date, timezone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** `HH:MM` -> minutes since midnight, or `null` when malformed. */
export function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
