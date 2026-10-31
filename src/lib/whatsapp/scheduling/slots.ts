import {
  computeFreeSlots,
  type HourWindow,
  type Interval,
  type WeeklyHours,
} from '@/src/lib/scheduling/slots'
import {
  addDaysToDateKey,
  zonedDateKey,
  zonedToUtc,
} from './time'

/**
 * Thin adapter over the shared slot engine (`scheduling/slots`). The agenda
 * keeps its own inputs (a day, a service with duration and buffer, the
 * professional's busy ranges) and hands the arithmetic to `computeFreeSlots`.
 *
 * One difference to know: C5 applies the buffer on both sides of every busy
 * range using the buffer of the service being offered. The booking repository
 * (`createIfFree`) is the authority on conflicts and uses each booked
 * service's own buffer; the two agree whenever services share a buffer.
 */
export type { HourWindow as WorkingWindow, WeeklyHours }
export type BusyRange = { startsAt: Date; endsAt: Date }

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

/** Horizon given to C5: the service bounds the booking window itself. */
const NO_HORIZON_DAYS = 3650

/** Start times offered on one day. */
export function computeSlots(input: SlotInput): Date[] {
  const busy: Interval[] = input.busy.map((range) => ({
    start: range.startsAt,
    end: range.endsAt,
  }))
  return computeFreeSlots({
    from: zonedToUtc(input.dateKey, 0, input.timeZone),
    to: zonedToUtc(addDaysToDateKey(input.dateKey, 1), 0, input.timeZone),
    now: input.now,
    durationMinutes: input.durationMinutes,
    bufferMinutes: input.bufferMinutes,
    stepMinutes: input.stepMinutes,
    minNoticeMinutes: input.minNoticeMinutes,
    maxDaysAhead: NO_HORIZON_DAYS,
    timezone: input.timeZone,
    weeklyHours: input.hours,
    busy,
  })
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
