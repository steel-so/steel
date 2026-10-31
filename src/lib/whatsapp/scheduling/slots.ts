import {
  addDaysToDateKey,
  weekdayOfDateKey,
  zonedDateKey,
  zonedToUtc,
} from './time'

export interface WorkingWindow {
  /** `HH:mm` */
  start: string
  /** `HH:mm`, exclusive. */
  end: string
}

/** Weekday (`"0"` = Sunday) -> windows. */
export type WeeklyHours = Record<string, WorkingWindow[]>

export interface BusyRange {
  startsAt: Date
  endsAt: Date
}

export const HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** Windows of a weekday, dropping malformed or inverted ones. */
export function windowsOf(
  hours: WeeklyHours,
  weekday: number,
): WorkingWindow[] {
  const windows = hours[String(weekday)]
  if (!Array.isArray(windows)) return []
  return windows.filter(
    (w) =>
      HOUR_PATTERN.test(w?.start ?? '') &&
      HOUR_PATTERN.test(w?.end ?? '') &&
      hhmmToMinutes(w.start) < hhmmToMinutes(w.end),
  )
}

export interface SlotInput {
  /** Calendar day in the agenda's zone, `YYYY-MM-DD`. */
  dateKey: string
  timeZone: string
  hours: WeeklyHours
  durationMinutes: number
  bufferMinutes: number
  /** Grid the starts step on, in minutes. */
  stepMinutes: number
  busy: BusyRange[]
  now: Date
  minNoticeMinutes: number
}

const MINUTE_MS = 60_000

/**
 * Start times offered on one day. A start is free when the appointment plus
 * its buffer fits inside a working window, no live appointment overlaps it
 * (the busy ranges already include their own buffers) and it respects the
 * minimum notice.
 */
export function computeSlots(input: SlotInput): Date[] {
  const earliest = input.now.getTime() + input.minNoticeMinutes * MINUTE_MS
  const occupied = input.durationMinutes + input.bufferMinutes
  const slots: Date[] = []
  for (const window of windowsOf(
    input.hours,
    weekdayOfDateKey(input.dateKey),
  )) {
    const end = hhmmToMinutes(window.end)
    for (
      let minute = hhmmToMinutes(window.start);
      minute + input.durationMinutes <= end;
      minute += input.stepMinutes
    ) {
      const startsAt = zonedToUtc(input.dateKey, minute, input.timeZone)
      const endsAt = new Date(startsAt.getTime() + occupied * MINUTE_MS)
      if (startsAt.getTime() < earliest) continue
      const clash = input.busy.some(
        (range) => startsAt < range.endsAt && endsAt > range.startsAt,
      )
      if (!clash) slots.push(startsAt)
    }
  }
  return slots
}

/** Whether `startsAt` is one of the offered starts of its day. */
export function isOfferedSlot(
  input: Omit<SlotInput, 'dateKey'>,
  startsAt: Date,
): boolean {
  const dateKey = zonedDateKey(startsAt, input.timeZone)
  return computeSlots({ ...input, dateKey }).some(
    (slot) => slot.getTime() === startsAt.getTime(),
  )
}

/** The days from `fromKey` for `days` days, as date keys. */
export function dateKeysFrom(fromKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToDateKey(fromKey, i))
}

export type DayPeriod = 'manha' | 'tarde'

/** Morning = before 12:00, afternoon = 12:00 on (in the agenda's zone). */
export function periodOf(date: Date, timeZone: string): DayPeriod {
  const key = zonedDateKey(date, timeZone)
  const noon = zonedToUtc(key, 12 * 60, timeZone)
  return date < noon ? 'manha' : 'tarde'
}
