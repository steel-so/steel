import {
  addDaysToDateKey,
  isValidTimezone,
  type LocalParts,
  localDateKey,
  localParts,
  weekdayOfDateKey,
  zonedDateKeyToUtc,
} from '@/src/lib/scheduling/tz'

/**
 * Thin adapter over the shared scheduling engine (`scheduling/tz`):
 * the agenda reuses its zone math and only adds the calendar-day helpers and
 * the pt-BR date text the WhatsApp messages need.
 */
export type ZonedParts = LocalParts

export const isValidTimeZone = isValidTimezone
export const zonedParts = localParts
/** `YYYY-MM-DD` of the instant in the zone. */
export const zonedDateKey = localDateKey

export const zonedToUtc = zonedDateKeyToUtc
export { addDaysToDateKey, weekdayOfDateKey }

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
