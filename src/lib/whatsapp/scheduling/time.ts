/** Wall-clock parts of an instant in an IANA zone. */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  }
}

/** `YYYY-MM-DD` of the instant in the zone. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * The instant at which the zone's wall clock reads `date` + `minuteOfDay`.
 * Two passes absorb the zone offset (and a DST jump on that day).
 */
export function zonedToUtc(
  dateKey: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  let guess = wall
  for (let pass = 0; pass < 2; pass += 1) {
    const p = zonedParts(new Date(guess), timeZone)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += wall - shown
  }
  return new Date(guess)
}

/** Weekday (0 = Sunday) of a `YYYY-MM-DD` calendar date. */
export function weekdayOfDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

/** "terça-feira, 04/11, às 14:30" in the zone. */
export function formatAppointmentDate(date: Date, timeZone: string): string {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter.format(date).replace(',', ', às')
}
