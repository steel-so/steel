import {
  isValidTimezone,
  type LocalParts,
  localDateKey,
  localParts,
  zonedTimeToUtc,
} from '@/src/lib/crm-meetings/tz'

/**
 * Thin adapter over the C5 meeting scheduler helpers (`crm-meetings/tz`):
 * the agenda reuses its zone math and only adds the calendar-day helpers and
 * the pt-BR date text the WhatsApp messages need.
 */
export type ZonedParts = LocalParts

export const isValidTimeZone = isValidTimezone
export const zonedParts = localParts
/** `YYYY-MM-DD` of the instant in the zone. */
export const zonedDateKey = localDateKey

/** The instant at which the zone's wall clock reads `dateKey` + `minuteOfDay`. */
export function zonedToUtc(
  dateKey: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return zonedTimeToUtc(
    {
      year,
      month,
      day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    timeZone,
  )
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
