/**
 * pt-BR formatting of the numbers inside insights (ADR 0040). Pure and
 * time-zone explicit: the worker runs in UTC, so every clock time is
 * rendered in the record's zone (SD calendar, workspace), never the host's.
 */

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** "1 chamado" / "3 chamados". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** `YYYY-MM-DD` of `at` in `timeZone` (falls back to UTC on a bad zone). */
export function dayKeyIn(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** Local hour (0–23) of `at` in `timeZone` (UTC on a bad zone). */
export function hourIn(at: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        hour: '2-digit',
      }).format(at),
    )
  } catch {
    return at.getUTCHours()
  }
}

/** A valid IANA zone, else `fallback`. */
export function safeTimeZone(
  zone: string | null | undefined,
  fallback: string,
) {
  if (!zone) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return fallback
  }
}

/**
 * Clock time of `at` for a sentence: "15:00", or "amanhã às 00:30" when it
 * falls on the next local day of `now`.
 */
export function clockIn(at: Date, now: Date, timeZone: string): string {
  let time: string
  try {
    time = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at)
  } catch {
    time = at.toISOString().slice(11, 16)
  }
  const sameDay = dayKeyIn(at, timeZone) === dayKeyIn(now, timeZone)
  return sameDay ? time : `amanhã às ${time}`
}

/** "às 15:00" / "amanhã às 00:30". */
export function atClock(at: Date, now: Date, timeZone: string): string {
  const clock = clockIn(at, now, timeZone)
  return clock.startsWith('amanhã') ? clock : `às ${clock}`
}

/** "R$ 12.500,00". */
export function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/** "-0,62" (two decimals, pt-BR comma). */
export function score(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Whole minutes between two instants (never negative). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS))
}

/** "45 min" / "2 h" / "2 h 10 min" / "3 dias". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < (DAY_MS / MINUTE_MS) * 2) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
  }
  return `${Math.floor(minutes / (DAY_MS / MINUTE_MS))} dias`
}

/** Whole percentage, never below 0. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.max(0, Math.round((part / whole) * 100))
}
