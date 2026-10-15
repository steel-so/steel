import {
  addDayKey,
  localDayKey,
  localDayStart,
} from '@/src/lib/productivity/period'

/**
 * Calendar math of the "Vendas" kit (pure). Periods are civil months or
 * quarters in the workspace time zone; business days are Monday to Friday
 * minus the holidays of the default business calendar, when one exists.
 */

export const DEFAULT_SALES_TIME_ZONE = 'America/Sao_Paulo'

export type SalesPeriodKind = 'month' | 'quarter'

export interface SalesWindow {
  /** `2026-10` or `2026-Q4` (same format as `CrmQuota.periodKey`). */
  key: string
  label: string
  /** Inclusive first and last civil day. */
  fromKey: string
  toKey: string
  /** Local midnight of the first day. */
  start: Date
  /** Local midnight of the day after the last one (exclusive). */
  end: Date
}

const monthLabel = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** First day key of the month `monthIndex` (0-based, may overflow) of `year`. */
function firstOfMonth(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`
}

/**
 * The month or quarter `now` falls on (in `timeZone`), shifted by `offset`
 * periods (`-1` = the previous one).
 */
export function salesWindow(
  now: Date,
  timeZone: string,
  period: SalesPeriodKind,
  offset = 0,
): SalesWindow {
  const today = localDayKey(now, timeZone)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1

  const span = period === 'quarter' ? 3 : 1
  const firstMonth =
    (period === 'quarter' ? Math.floor(month / 3) * 3 : month) + offset * span

  const fromKey = firstOfMonth(year, firstMonth)
  const nextKey = firstOfMonth(year, firstMonth + span)
  const toKey = addDayKey(nextKey, -1)

  const startYear = Number(fromKey.slice(0, 4))
  const startMonth = Number(fromKey.slice(5, 7))
  const key =
    period === 'quarter'
      ? `${startYear}-Q${Math.floor((startMonth - 1) / 3) + 1}`
      : fromKey.slice(0, 7)
  const label =
    period === 'quarter'
      ? `${Math.floor((startMonth - 1) / 3) + 1}º trimestre de ${startYear}`
      : monthLabel.format(new Date(Date.UTC(startYear, startMonth - 1, 15)))

  return {
    key,
    label,
    fromKey,
    toKey,
    start: localDayStart(fromKey, timeZone),
    end: localDayStart(nextKey, timeZone),
  }
}

/** Today as a window of one civil day. */
export function dayWindow(
  now: Date,
  timeZone: string,
): {
  key: string
  start: Date
  end: Date
} {
  const key = localDayKey(now, timeZone)
  return {
    key,
    start: localDayStart(key, timeZone),
    end: localDayStart(addDayKey(key, 1), timeZone),
  }
}

/** Monday-to-Sunday week of `now`, as day keys (inclusive). */
export function weekDays(
  now: Date,
  timeZone: string,
): { fromKey: string; toKey: string } {
  const today = localDayKey(now, timeZone)
  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay()
  const fromKey = addDayKey(today, -((weekday + 6) % 7))
  return { fromKey, toKey: addDayKey(fromKey, 6) }
}

export function isBusinessDay(key: string, holidays: Set<string>): boolean {
  const weekday = new Date(`${key}T12:00:00.000Z`).getUTCDay()
  return weekday !== 0 && weekday !== 6 && !holidays.has(key)
}

/** Business days between two day keys, both inclusive (0 when reversed). */
export function businessDaysBetween(
  fromKey: string,
  toKey: string,
  holidays: Set<string>,
): number {
  let count = 0
  for (let key = fromKey; key <= toKey; key = addDayKey(key, 1)) {
    if (isBusinessDay(key, holidays)) count += 1
  }
  return count
}

/** Civil days from `fromKey` to `toKey` (negative when `toKey` is before). */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00.000Z`)
  const b = Date.parse(`${toKey}T00:00:00.000Z`)
  return Math.round((b - a) / 86_400_000)
}

export interface BusinessDayProgress {
  total: number
  /** Business days from the first day through today (today included). */
  elapsed: number
  /** Business days from today through the last day (today included). */
  left: number
}

/**
 * Business days of a window as seen on `todayKey`. Today counts both as
 * worked (its wins are already in) and as still available (the team can
 * still close today), so `elapsed + left` exceeds `total` by one on a
 * business day.
 */
export function businessDayProgress(
  window: Pick<SalesWindow, 'fromKey' | 'toKey'>,
  todayKey: string,
  holidays: Set<string>,
): BusinessDayProgress {
  const total = businessDaysBetween(window.fromKey, window.toKey, holidays)
  if (todayKey < window.fromKey) return { total, elapsed: 0, left: total }
  if (todayKey > window.toKey) return { total, elapsed: total, left: 0 }
  return {
    total,
    elapsed: businessDaysBetween(window.fromKey, todayKey, holidays),
    left: businessDaysBetween(todayKey, window.toKey, holidays),
  }
}

/** Holiday dates (`YYYY-MM-DD`) of a business calendar's `holidays` JSON. */
export function holidaySet(value: unknown): Set<string> {
  const set = new Set<string>()
  if (!Array.isArray(value)) return set
  for (const entry of value) {
    const date =
      entry && typeof entry === 'object'
        ? (entry as { date?: unknown }).date
        : undefined
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      set.add(date)
    }
  }
  return set
}
