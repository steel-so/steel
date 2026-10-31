/**
 * Shared slot/availability engine (ADR 0059). Used by the CRM meeting pages
 * (C5) and by the WhatsApp native scheduling (Z10): weekly windows in an IANA
 * zone, step, minimum notice, horizon and buffer-aware conflict checks.
 */
import { type LocalParts, localParts, parseClock, zonedTimeToUtc } from './tz'

export interface Interval {
  start: Date
  end: Date
}

export interface HourWindow {
  start: string
  end: string
}

/** `{ "1": [{start:"09:00", end:"12:00"}] }`, keys are weekdays (0 = Sunday). */
export type WeeklyHours = Record<string, HourWindow[]>

export interface SlotRules {
  /** Search window, inclusive start / exclusive end. */
  from: Date
  to: Date
  now: Date
  durationMinutes: number
  bufferMinutes: number
  stepMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  timezone: string
  weeklyHours: WeeklyHours
  busy: Interval[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** The Monday-to-Friday 09:00-18:00 default of a seller without a setup. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  '1': [{ start: '09:00', end: '18:00' }],
  '2': [{ start: '09:00', end: '18:00' }],
  '3': [{ start: '09:00', end: '18:00' }],
  '4': [{ start: '09:00', end: '18:00' }],
  '5': [{ start: '09:00', end: '18:00' }],
}

/** Windows of one weekday, sorted, malformed and inverted ones dropped. */
export function windowsOf(
  weeklyHours: WeeklyHours,
  weekday: number,
): Array<{ startMin: number; endMin: number }> {
  const raw = weeklyHours[String(weekday)] ?? []
  const out: Array<{ startMin: number; endMin: number }> = []
  for (const window of raw) {
    const startMin = parseClock(window.start)
    const endMin = parseClock(window.end)
    if (startMin === null || endMin === null || endMin <= startMin) continue
    out.push({ startMin, endMin })
  }
  return out.sort((a, b) => a.startMin - b.startMin)
}

/**
 * Buffer-aware conflict between a candidate and one neighbour. The candidate
 * needs `afterCandidateMinutes` of room before the neighbour starts and the
 * neighbour needs `afterOtherMinutes` before the candidate may start. C5 uses
 * the page buffer for both, Z10 uses the candidate's service buffer on the
 * first and the neighbour's own service buffer on the second.
 */
export function bufferedOverlap(
  candidate: Interval,
  other: Interval,
  buffers: { afterCandidateMinutes: number; afterOtherMinutes: number },
): boolean {
  return (
    other.start.getTime() <
      candidate.end.getTime() + buffers.afterCandidateMinutes * MINUTE_MS &&
    other.end.getTime() + buffers.afterOtherMinutes * MINUTE_MS >
      candidate.start.getTime()
  )
}

/** Does `[start, end)` collide with a busy interval (buffer on both sides)? */
export function collides(
  start: Date,
  end: Date,
  busy: Interval[],
  bufferMinutes: number,
): boolean {
  const candidate = { start, end }
  const buffers = {
    afterCandidateMinutes: bufferMinutes,
    afterOtherMinutes: bufferMinutes,
  }
  return busy.some((interval) => bufferedOverlap(candidate, interval, buffers))
}

/**
 * Free start instants for one seller. Slots fall on the seller's working
 * windows in the seller's zone, advance by `stepMinutes`, respect the
 * minimum notice and the booking horizon, and skip anything that collides
 * (with buffer) with an existing commitment.
 */
export function computeFreeSlots(rules: SlotRules): Date[] {
  const earliest = Math.max(
    rules.from.getTime(),
    rules.now.getTime() + rules.minNoticeMinutes * MINUTE_MS,
  )
  const latest = Math.min(
    rules.to.getTime(),
    rules.now.getTime() + rules.maxDaysAhead * DAY_MS,
  )
  if (earliest >= latest) return []

  const duration = rules.durationMinutes * MINUTE_MS
  const step = Math.max(5, rules.stepMinutes) * MINUTE_MS
  const slots: Date[] = []
  const seen = new Set<number>()

  // Walk the seller's local days from one day before to one after the window.
  let cursor = earliest - DAY_MS
  const last = latest + DAY_MS
  let previousKey = ''
  while (cursor <= last) {
    const parts: LocalParts = localParts(new Date(cursor), rules.timezone)
    const key = `${parts.year}-${parts.month}-${parts.day}`
    cursor += DAY_MS / 2
    if (key === previousKey) continue
    previousKey = key

    for (const window of windowsOf(rules.weeklyHours, parts.weekday)) {
      const windowStart = zonedTimeToUtc(
        {
          year: parts.year,
          month: parts.month,
          day: parts.day,
          hour: Math.floor(window.startMin / 60),
          minute: window.startMin % 60,
        },
        rules.timezone,
      ).getTime()
      const windowEnd =
        windowStart + (window.endMin - window.startMin) * MINUTE_MS
      for (let t = windowStart; t + duration <= windowEnd; t += step) {
        if (t < earliest || t >= latest || seen.has(t)) continue
        const start = new Date(t)
        const end = new Date(t + duration)
        if (collides(start, end, rules.busy, rules.bufferMinutes)) continue
        seen.add(t)
        slots.push(start)
      }
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime())
}
