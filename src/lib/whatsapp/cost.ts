import type { WhatsAppCostCategory } from '@prisma/client'
import type { WhatsAppCostContext } from './types'

/**
 * Pure helpers of the cost analysis (ADR 0050): price resolution, country
 * detection, fee proration and the month projection. No I/O, so the
 * aggregation math is testable with fixed fixtures.
 */

export const DEFAULT_COUNTRY = 'BR'
export const DEFAULT_CURRENCY = 'BRL'

/** Categories Meta bills per template message (SERVICE is free). */
export const BILLABLE_CATEGORIES = [
  'MARKETING',
  'UTILITY',
  'AUTHENTICATION',
] as const satisfies readonly WhatsAppCostCategory[]

export type BillableCategory = (typeof BILLABLE_CATEGORIES)[number]

/**
 * Editable starting point seeded into a workspace's price table the first
 * time an admin opens it. They are **reference values only** (BRL, Brazil):
 * Meta changes its rates, so the admin must check them against the Meta
 * account. The estimate never reads these constants once rows exist.
 */
export const REFERENCE_PRICES: Record<BillableCategory, number> = {
  MARKETING: 0.3625,
  UTILITY: 0.04,
  AUTHENTICATION: 0.195,
}

/** Date from which the seeded reference rows count (before any send). */
export const REFERENCE_VALID_FROM = new Date('2000-01-01T00:00:00.000Z')

/** Calling code -> ISO country, longest prefix first. Others fall back to BR. */
const CALLING_CODES: [string, string][] = [
  ['598', 'UY'],
  ['595', 'PY'],
  ['351', 'PT'],
  ['57', 'CO'],
  ['56', 'CL'],
  ['55', 'BR'],
  ['54', 'AR'],
  ['52', 'MX'],
  ['1', 'US'],
]

/** Country of the recipient, from the WhatsApp id (digits with country code). */
export function countryFromWaId(waId: string): string {
  const digits = waId.replace(/\D/g, '')
  const match = CALLING_CODES.find(([prefix]) => digits.startsWith(prefix))
  return match ? match[1] : DEFAULT_COUNTRY
}

export interface PriceRow {
  category: WhatsAppCostCategory
  country: string
  currency: string
  unitPrice: number
  /** Price of a Marketing Messages Lite message; null/absent = `unitPrice`. */
  liteUnitPrice?: number | null
  validFrom: Date
}

export interface ResolvedPrice {
  unitPrice: number
  currency: string
  /** Where the number came from: the exact country, the BR row or nothing. */
  source: 'country' | 'default-country' | 'none'
}

function latestAt(
  rows: PriceRow[],
  category: WhatsAppCostCategory,
  country: string,
  at: Date,
): PriceRow | undefined {
  return rows
    .filter(
      (row) =>
        row.category === category &&
        row.country === country &&
        row.validFrom.getTime() <= at.getTime(),
    )
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0]
}

/**
 * Unit price of a category at `at`: the row of the recipient's country with
 * the latest `validFrom` not after `at`, else the same rule for the default
 * country (BR), else zero (`source: 'none'` — the entry still counts volume).
 * `SERVICE` is always free. A Marketing Messages Lite send (`options.lite`)
 * uses the row's `liteUnitPrice` when it has one, else the regular price.
 */
export function resolveUnitPrice(
  rows: PriceRow[],
  category: WhatsAppCostCategory,
  country: string,
  at: Date,
  options: { lite?: boolean } = {},
): ResolvedPrice {
  if (category === 'SERVICE') {
    return { unitPrice: 0, currency: DEFAULT_CURRENCY, source: 'country' }
  }
  const priceOf = (row: PriceRow) =>
    options.lite && category === 'MARKETING' && row.liteUnitPrice != null
      ? row.liteUnitPrice
      : row.unitPrice
  const exact = latestAt(rows, category, country, at)
  if (exact) {
    return {
      unitPrice: priceOf(exact),
      currency: exact.currency,
      source: 'country',
    }
  }
  const fallback = latestAt(rows, category, DEFAULT_COUNTRY, at)
  if (fallback) {
    return {
      unitPrice: priceOf(fallback),
      currency: fallback.currency,
      source: 'default-country',
    }
  }
  return { unitPrice: 0, currency: DEFAULT_CURRENCY, source: 'none' }
}

/** Maps a Meta template category string onto the billable categories. */
export function normalizeTemplateCategory(
  category: string | null | undefined,
): BillableCategory {
  const value = (category ?? '').toUpperCase()
  if (value === 'UTILITY' || value === 'AUTHENTICATION') return value
  // Unknown or missing: assume the most expensive tier (never under-report).
  return 'MARKETING'
}

/** Money is stored with 6 decimals; round the product to that scale. */
export function multiplyMoney(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 1e6) / 1e6
}

/** Rounds to cents for display math (totals, ratios). */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/** Cost per unit; zero volume yields 0 instead of a divide-by-zero. */
export function safeRatio(total: number, volume: number): number {
  return volume > 0 ? total / volume : 0
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * Part of a flat monthly fee that belongs to `[from, to]` (UTC days, both
 * inclusive): each month contributes `fee x days inside it / days in it`.
 */
export function proratedFee(monthlyFee: number, from: Date, to: Date): number {
  if (monthlyFee <= 0 || to.getTime() < from.getTime()) return 0
  let total = 0
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1)
  while (cursor <= end) {
    const year = new Date(cursor).getUTCFullYear()
    const month = new Date(cursor).getUTCMonth()
    const length = daysInMonthUtc(year, month)
    const first = Math.max(Date.UTC(year, month, 1), startOfUtcDay(from))
    const last = Math.min(Date.UTC(year, month, length), startOfUtcDay(to))
    const days = Math.floor((last - first) / 86_400_000) + 1
    if (days > 0) total += (monthlyFee * days) / length
    cursor = Date.UTC(year, month + 1, 1)
  }
  return total
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Month-end projection from the run-rate: variable cost so far, spread over
 * the days elapsed, extended to the whole month. Fees are added by the
 * caller (they are committed regardless of volume).
 */
export function projectMonthCost(input: {
  costToDate: number
  daysElapsed: number
  daysInMonth: number
}): number {
  if (input.daysElapsed <= 0) return 0
  return (input.costToDate / input.daysElapsed) * input.daysInMonth
}

export type BudgetLevel = 80 | 100

/** Highest budget alert level reached by `spent`, or null. */
export function budgetLevel(
  spent: number,
  budget: number | null,
): BudgetLevel | null {
  if (budget === null || budget <= 0) return null
  const ratio = spent / budget
  if (ratio >= 1) return 100
  if (ratio >= 0.8) return 80
  return null
}

const SP_OFFSET = '-03:00'

/**
 * Instants of an inclusive `YYYY-MM-DD` range in the São Paulo calendar (the
 * same one as the usage month): `[start, endExclusive)`.
 */
export function rangeBounds(
  from: string,
  to: string,
): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00${SP_OFFSET}`)
  const endExclusive = new Date(
    new Date(`${to}T00:00:00${SP_OFFSET}`).getTime() + 86_400_000,
  )
  return { start, endExclusive }
}

/** `[start, endExclusive)` of a `YYYY-MM` usage month in São Paulo. */
export function monthBounds(period: string): {
  start: Date
  endExclusive: Date
} {
  const [year, month] = period.split('-').map(Number)
  const start = new Date(`${period}-01T00:00:00${SP_OFFSET}`)
  const next =
    month === 12
      ? `${year + 1}-01`
      : `${year}-${String(month + 1).padStart(2, '0')}`
  return { start, endExclusive: new Date(`${next}-01T00:00:00${SP_OFFSET}`) }
}

/** Number of days of a `YYYY-MM` month. */
export function daysInPeriod(period: string): number {
  const [year, month] = period.split('-').map(Number)
  return daysInMonthUtc(year, month - 1)
}

/** `YYYY-MM-DD` of an instant in the São Paulo calendar. */
export function saoPauloDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Cost context of a message an agent sent from the inbox. */
export function agentCost(
  userId: string,
  conversationId: string,
): WhatsAppCostContext {
  return { source: 'AGENT', userId, conversationId }
}

/** Default report range: first day of the current month up to today (SP). */
export function currentMonthRange(now = new Date()): {
  from: string
  to: string
} {
  const today = saoPauloDay(now)
  return { from: `${today.slice(0, 7)}-01`, to: today }
}
