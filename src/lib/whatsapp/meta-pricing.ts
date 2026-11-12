import 'server-only'
import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  multiplyMoney,
  type PriceRow,
  resolveUnitPrice,
} from './cost'
import { MetaApiError, type MetaCredentials, metaRequest } from './meta-client'
import { whatsappUsagePeriod } from './usage-period'

/**
 * Real month spend of a number from Meta's `pricing_analytics` (ADR 0064).
 * Meta answers only for whole UTC days that already ended, so the window is
 * `[first day of the usage month 00:00 UTC, today 00:00 UTC)`; the caller
 * adds today's partial day from the Steel ledger.
 */

export type MetaSpendSource = 'META_COST' | 'META_VOLUME'

export interface MetaSpendCategoryRow {
  /** Meta's pricing category (MARKETING, UTILITY, AUTHENTICATION, SERVICE…). */
  category: string
  /** Every message Meta counted in the category, free ones included. */
  volume: number
  /** Messages Meta bills (pricing type REGULAR). */
  billableVolume: number
  cost: number
}

export interface MetaSpendReading {
  source: MetaSpendSource
  cost: number
  currency: string
  byCategory: MetaSpendCategoryRow[]
  periodStart: Date
  periodEnd: Date
  /** Why COST was not used (Meta refused it), when the source is VOLUME. */
  costRefusal?: string
}

export interface MetaSpendWindow {
  /** Usage month `YYYY-MM` (America/Sao_Paulo). */
  period: string
  start: Date
  end: Date
}

interface PricingPoint {
  start?: number
  pricing_category?: string
  pricing_type?: string
  volume?: number
  cost?: number
}

interface PricingResponse {
  currency?: string
  pricing_analytics?: { data?: { data_points?: PricingPoint[] }[] }
}

/** A slow Graph API must not hold the costs page hostage. */
const REQUEST_TIMEOUT_MS = 10_000

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80_004])

/** Closed UTC days of the usage month of `now` that Meta can answer for. */
export function metaSpendWindow(now: Date): MetaSpendWindow {
  const period = whatsappUsagePeriod(now)
  const start = new Date(`${period}-01T00:00:00.000Z`)
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  return { period, start, end: today < start ? start : today }
}

/** Digits of Meta's `display_phone_number` (`+55 11 99999-0000`). */
export function displayDigits(display: string | null | undefined): string {
  return (display ?? '').replace(/\D/g, '')
}

const unix = (date: Date) => Math.floor(date.getTime() / 1000)

/** The `pricing_analytics` field expression (Graph API field syntax). */
export function pricingAnalyticsField(
  window: Pick<MetaSpendWindow, 'start' | 'end'>,
  digits: string,
  metrics: ('COST' | 'VOLUME')[],
): string {
  return [
    'pricing_analytics',
    `start(${unix(window.start)})`,
    `end(${unix(window.end)})`,
    'granularity(DAILY)',
    `phone_numbers(${JSON.stringify([digits])})`,
    `metric_types(${JSON.stringify(metrics)})`,
    'dimensions(["PRICING_CATEGORY","PRICING_TYPE"])',
  ].join('.')
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Every data point of the response, whatever the nesting Meta sends. */
export function pricingPoints(body: PricingResponse | null): PricingPoint[] {
  const data = body?.pricing_analytics?.data
  const series = Array.isArray(data) ? data : []
  return series.flatMap((entry) =>
    Array.isArray(entry?.data_points) ? entry.data_points : [],
  )
}

/** Free messages: service replies and the free entry-point / CS windows. */
function isFree(point: PricingPoint): boolean {
  const type = (point.pricing_type ?? 'REGULAR').toUpperCase()
  const category = (point.pricing_category ?? '').toUpperCase()
  return type.startsWith('FREE') || category === 'SERVICE'
}

/** Meta category -> price table category (+ whether it is the Lite price). */
function priceCategory(category: string): {
  category: PriceRow['category']
  lite: boolean
} {
  if (category === 'MARKETING_LITE') {
    return { category: 'MARKETING', lite: true }
  }
  if (category.startsWith('AUTHENTICATION')) {
    return { category: 'AUTHENTICATION', lite: false }
  }
  if (category === 'UTILITY') return { category, lite: false }
  // Unknown category: price it as the most expensive tier (never under-report).
  return { category: 'MARKETING', lite: false }
}

/**
 * Turns the data points into the month total and the per-category rows.
 * `META_COST` sums Meta's own cost; `META_VOLUME` prices each billable point
 * with the workspace table at the day of the point (BR row, ADR 0050).
 */
export function summarizePricing(
  points: PricingPoint[],
  source: MetaSpendSource,
  prices: PriceRow[],
): { cost: number; byCategory: MetaSpendCategoryRow[] } {
  const rows = new Map<string, MetaSpendCategoryRow>()
  let total = 0
  for (const point of points) {
    const category = (point.pricing_category ?? 'OTHER').toUpperCase()
    const volume = num(point.volume)
    const free = isFree(point)
    let cost = 0
    if (source === 'META_COST') {
      cost = num(point.cost)
    } else if (!free && volume > 0) {
      const target = priceCategory(category)
      const at = new Date(num(point.start) * 1000)
      const price = resolveUnitPrice(
        prices,
        target.category,
        DEFAULT_COUNTRY,
        at,
        { lite: target.lite },
      )
      cost = multiplyMoney(price.unitPrice, volume)
    }
    const row = rows.get(category) ?? {
      category,
      volume: 0,
      billableVolume: 0,
      cost: 0,
    }
    row.volume += volume
    if (!free) row.billableVolume += volume
    row.cost = multiplyMoney(row.cost + cost, 1)
    rows.set(category, row)
    total += cost
  }
  return {
    cost: multiplyMoney(total, 1),
    byCategory: [...rows.values()].sort(
      (a, b) => b.cost - a.cost || b.volume - a.volume,
    ),
  }
}

/** pt-BR reason shown when the Meta read fails (the last reading stays). */
export function describeMetaSpendError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'A Meta demorou demais para responder. Mostrando a última leitura.'
  }
  if (error instanceof MetaApiError) {
    if (error.code === 190 || error.status === 401) {
      return 'O token de acesso da conexão expirou ou foi revogado. Reconecte o número.'
    }
    if (error.code === 10 || error.status === 403) {
      return 'A conexão não tem permissão para ler os gastos na Meta.'
    }
    if (
      error.status === 429 ||
      (error.code !== undefined && RATE_LIMIT_CODES.has(error.code))
    ) {
      return 'A Meta limitou as consultas por enquanto. Mostrando a última leitura.'
    }
    if (error.status >= 500) {
      return 'A Meta está instável agora. Mostrando a última leitura.'
    }
  }
  return 'Não foi possível consultar a Meta agora. Mostrando a última leitura.'
}

async function readPricing(
  credentials: MetaCredentials,
  window: MetaSpendWindow,
  digits: string,
  metrics: ('COST' | 'VOLUME')[],
): Promise<PricingResponse | null> {
  const fields = `currency,${pricingAnalyticsField(window, digits, metrics)}`
  return metaRequest<PricingResponse | null>(
    credentials,
    `/${credentials.wabaId}?fields=${encodeURIComponent(fields)}`,
    { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )
}

/**
 * Reads the month spend of the connection's number from Meta. Tries the COST
 * metric first; when Meta refuses it (our app gets code 10 today), prices
 * Meta's VOLUME with the workspace table. Returns null when no day of the
 * month has closed yet (nothing to ask). Throws on a Meta failure.
 */
export async function fetchMetaSpend(
  credentials: MetaCredentials,
  prices: PriceRow[],
  now: Date,
): Promise<MetaSpendReading | null> {
  const window = metaSpendWindow(now)
  if (window.end.getTime() <= window.start.getTime()) return null

  const phone = await metaRequest<{ display_phone_number?: string } | null>(
    credentials,
    `/${credentials.phoneNumberId}?fields=display_phone_number`,
    { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )
  const digits = displayDigits(phone?.display_phone_number)
  if (!digits) throw new Error('Meta returned no display_phone_number')

  const base = { periodStart: window.start, periodEnd: window.end }
  try {
    const body = await readPricing(credentials, window, digits, [
      'COST',
      'VOLUME',
    ])
    const summary = summarizePricing(pricingPoints(body), 'META_COST', prices)
    return {
      ...base,
      ...summary,
      source: 'META_COST',
      currency: body?.currency || DEFAULT_CURRENCY,
    }
  } catch (costError) {
    const body = await readPricing(credentials, window, digits, ['VOLUME'])
    const summary = summarizePricing(pricingPoints(body), 'META_VOLUME', prices)
    return {
      ...base,
      ...summary,
      source: 'META_VOLUME',
      // Priced with the workspace table, which is in BRL.
      currency: prices[0]?.currency ?? DEFAULT_CURRENCY,
      costRefusal:
        costError instanceof Error ? costError.message : String(costError),
    }
  }
}
