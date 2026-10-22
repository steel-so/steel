import {
  localClock,
  nextBusinessOpening,
  type WhatsAppBusinessHours,
} from './business-hours'

/**
 * Pure time math of the Communication SLA (ADR 0048), on top of the
 * workspace business hours (`business-hours.ts`). When the hours are disabled
 * the clock is plain wall time.
 */

const MINUTE_MS = 60 * 1000
const DAY_MINUTES = 24 * 60
/** Safety net for the window walks (a week of windows is ~8; this is plenty). */
const MAX_WINDOWS = 5000

/**
 * Whole minutes from `at` (inside an open window) to the moment the window
 * closes. A "whole day" window (start == end) closes at midnight; the next
 * service day opens it again, which the callers handle by walking on.
 */
function minutesUntilWindowCloses(
  hours: WhatsAppBusinessHours,
  at: Date,
): number {
  const [startH, startM] = hours.start.split(':').map(Number)
  const [endH, endM] = hours.end.split(':').map(Number)
  const start = startH * 60 + startM
  const end = endH * 60 + endM
  const { minute } = localClock(at)

  if (start === end) return DAY_MINUTES - minute
  if (start < end) return end - minute
  // Overnight: evening part runs to midnight plus the next morning.
  return minute >= start ? DAY_MINUTES - minute + end : end - minute
}

/** Start of the minute `at` falls in. */
function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS)
}

/**
 * The instant at which `minutes` of open time have elapsed since `from`.
 * `null` when the hours never open (no weekday selected).
 */
export function addBusinessMinutes(
  hours: WhatsAppBusinessHours,
  from: Date,
  minutes: number,
): Date | null {
  if (!hours.enabled) return new Date(from.getTime() + minutes * MINUTE_MS)

  let remainingMs = minutes * MINUTE_MS
  let cursor = nextBusinessOpening(hours, from)
  for (let i = 0; cursor && i < MAX_WINDOWS; i += 1) {
    const windowStart = floorToMinute(cursor)
    const windowEnd = new Date(
      windowStart.getTime() +
        minutesUntilWindowCloses(hours, windowStart) * MINUTE_MS,
    )
    const availableMs = windowEnd.getTime() - cursor.getTime()
    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs)
    }
    remainingMs -= availableMs
    cursor = nextBusinessOpening(hours, windowEnd)
  }
  return null
}

/** Open (counted) milliseconds between `from` and `to`, 0 when `to <= from`. */
export function businessMillisBetween(
  hours: WhatsAppBusinessHours,
  from: Date,
  to: Date,
): number {
  if (to <= from) return 0
  if (!hours.enabled) return to.getTime() - from.getTime()

  let counted = 0
  let cursor = nextBusinessOpening(hours, from)
  for (let i = 0; cursor && cursor < to && i < MAX_WINDOWS; i += 1) {
    const windowStart = floorToMinute(cursor)
    const windowEnd = new Date(
      windowStart.getTime() +
        minutesUntilWindowCloses(hours, windowStart) * MINUTE_MS,
    )
    const segmentEnd = windowEnd < to ? windowEnd : to
    counted += segmentEnd.getTime() - cursor.getTime()
    cursor = nextBusinessOpening(hours, windowEnd)
  }
  return counted
}

export interface SlaDeadlines {
  firstResponseDueAt: Date
  firstResponseWarnAt: Date
  resolutionDueAt: Date | null
  resolutionWarnAt: Date | null
}

export interface SlaTargets {
  firstResponseMinutes: number
  resolutionMinutes: number | null
  warnAtPercent: number
  businessHoursOnly: boolean
}

function deadline(
  hours: WhatsAppBusinessHours,
  businessHoursOnly: boolean,
  from: Date,
  minutes: number,
): Date | null {
  return businessHoursOnly
    ? addBusinessMinutes(hours, from, minutes)
    : new Date(from.getTime() + minutes * MINUTE_MS)
}

/**
 * Due and warning instants of a cycle started at `startedAt`. `null` when
 * the business hours never open (a policy that can never be met is not
 * tracked).
 */
export function computeSlaDeadlines(
  hours: WhatsAppBusinessHours,
  targets: SlaTargets,
  startedAt: Date,
): SlaDeadlines | null {
  const warnMinutes = (minutes: number) =>
    Math.max(1, Math.floor((minutes * targets.warnAtPercent) / 100))

  const firstDue = deadline(
    hours,
    targets.businessHoursOnly,
    startedAt,
    targets.firstResponseMinutes,
  )
  const firstWarn = deadline(
    hours,
    targets.businessHoursOnly,
    startedAt,
    warnMinutes(targets.firstResponseMinutes),
  )
  if (!firstDue || !firstWarn) return null

  let resolutionDueAt: Date | null = null
  let resolutionWarnAt: Date | null = null
  if (targets.resolutionMinutes !== null) {
    resolutionDueAt = deadline(
      hours,
      targets.businessHoursOnly,
      startedAt,
      targets.resolutionMinutes,
    )
    resolutionWarnAt = deadline(
      hours,
      targets.businessHoursOnly,
      startedAt,
      warnMinutes(targets.resolutionMinutes),
    )
    if (!resolutionDueAt || !resolutionWarnAt) return null
  }

  return {
    firstResponseDueAt: firstDue,
    firstResponseWarnAt: firstWarn,
    resolutionDueAt,
    resolutionWarnAt,
  }
}

export type SlaState = 'OK' | 'AT_RISK' | 'BREACHED'

/** State of a single target at `now` given its warn/due instants. */
export function slaTargetState(
  target: { warnAt: Date; dueAt: Date },
  now: Date,
): SlaState {
  if (now >= target.dueAt) return 'BREACHED'
  if (now >= target.warnAt) return 'AT_RISK'
  return 'OK'
}

/** Worst of two states (BREACHED > AT_RISK > OK). */
export function worstSlaState(a: SlaState, b: SlaState): SlaState {
  const rank: Record<SlaState, number> = { OK: 0, AT_RISK: 1, BREACHED: 2 }
  return rank[a] >= rank[b] ? a : b
}
