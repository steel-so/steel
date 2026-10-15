/**
 * Calendar math of the site metrics: local days (`YYYY-MM-DD`) in the
 * site's timezone and the UTC instants that bound them. Pure; `now` is
 * always injected.
 */

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` of `date` in `timezone`. */
export function localDayOf(date: Date, timezone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** `day` shifted by `amount` days. */
export function addDays(day: string, amount: number): string {
  const time = Date.parse(`${day}T00:00:00Z`) + amount * DAY_MS
  return new Date(time).toISOString().slice(0, 10)
}

/** Every day from `from` to `to`, both included. */
export function listDays(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

/** Offset of `timezone` from UTC at `instant`, in ms (São Paulo: -3 h). */
function offsetAt(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** UTC instant of local midnight that starts `day` in `timezone`. */
export function startOfLocalDay(day: string, timezone: string): Date {
  const naive = Date.parse(`${day}T00:00:00Z`)
  const first = naive - offsetAt(naive, timezone)
  // A DST change between the guess and the result moves the offset.
  return new Date(naive - offsetAt(first, timezone))
}

export interface SiteAnalyticsRange {
  from: string
  to: string
  /** UTC window `[start, end)` of the local days. */
  start: Date
  end: Date
  days: string[]
}

/** The local-day range of a metrics query (default: the last `fallback`
 * days ending today). */
export function resolveAnalyticsRange(
  input: { from?: string; to?: string },
  timezone: string,
  now: Date,
  fallback = 30,
): SiteAnalyticsRange {
  const to = input.to ?? localDayOf(now, timezone)
  const from = input.from ?? addDays(to, -(fallback - 1))
  return {
    from,
    to,
    start: startOfLocalDay(from, timezone),
    end: startOfLocalDay(addDays(to, 1), timezone),
    days: listDays(from, to),
  }
}

/** The range of the same length right before `range`. */
export function previousRange(
  range: SiteAnalyticsRange,
  timezone: string,
): SiteAnalyticsRange {
  const length = range.days.length
  const to = addDays(range.from, -1)
  const from = addDays(to, -(length - 1))
  return {
    from,
    to,
    start: startOfLocalDay(from, timezone),
    end: range.start,
    days: listDays(from, to),
  }
}

/** `part / total` rounded to 4 decimals; 0 without a total. */
export function ratio(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 10_000) / 10_000
}
