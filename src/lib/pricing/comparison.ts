import { PLAN_PRICES } from '@/src/config/plan-prices'
import { PLAN_CATALOG } from '@/src/config/plans'
import type {
  Competitor,
  CompetitorPlan,
  Currency,
  ListPrice,
} from '@/src/schemas/competitor-comparison.schema'
import type { PlanTier } from '@/src/schemas/plan.schema'

/** Team size used for the "custo para uma equipe de 10" column. */
export const COMPARISON_TEAM_SIZE = 10

const PLAN_LABELS: Record<PlanTier, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  BUSINESS: 'Business',
  ENTERPRISE: 'Enterprise',
}

/** `5500, 'USD'` → `US$ 55`; `6570, 'BRL'` → `R$ 65,70`. */
export function formatMoney(cents: number, currency: Currency): string {
  const value = cents / 100
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/ /g, ' ')
}

export function formatListPrice(price: ListPrice, currency: Currency): string {
  switch (price.kind) {
    case 'per-seat':
      return `${formatMoney(price.cents, currency)} por usuário/mês`
    case 'per-seat-range':
      return `${formatMoney(price.minCents, currency)} a ${formatMoney(price.maxCents, currency)} por usuário/mês`
    case 'flat':
      return `${formatMoney(price.cents, currency)} por mês`
    case 'quote':
      return 'Sob consulta'
  }
}

/**
 * Monthly cost for `seats` users on annual billing, or `null` when the
 * price is not per seat (flat or on request) and so cannot be computed.
 */
export function teamMonthlyCost(
  price: ListPrice,
  currency: Currency,
  seats = COMPARISON_TEAM_SIZE,
): string | null {
  switch (price.kind) {
    case 'per-seat':
      return formatMoney(price.cents * seats, currency)
    case 'per-seat-range':
      return `${formatMoney(price.minCents * seats, currency)} a ${formatMoney(price.maxCents * seats, currency)}`
    default:
      return null
  }
}

function seatNote(tier: PlanTier): string | undefined {
  const seats = PLAN_CATALOG[tier].limits.seats
  return seats === null ? undefined : `até ${seats} usuários`
}

/**
 * Steel's own rows, read from `src/config/plan-prices.ts` (the single source
 * of truth) and the seat limits of `src/config/plans.ts`. One Steel seat
 * covers ServiceDesk, CRM and Comunicação.
 */
export function steelComparisonPlans(): CompetitorPlan[] {
  return (Object.keys(PLAN_LABELS) as PlanTier[]).map((tier) => {
    const price = PLAN_PRICES[tier]
    const note = seatNote(tier)
    return {
      name: PLAN_LABELS[tier],
      price: price
        ? { kind: 'per-seat', cents: Math.round(price.yearly / 12) }
        : { kind: 'quote' },
      ...(note ? { note } : {}),
    }
  })
}

/**
 * Brandfetch Logo Link client id (public: it travels in every image URL).
 * The CDN only answers real browsers hotlinking from a page, so logos are
 * never downloaded or proxied through next/image.
 */
const BRANDFETCH_CLIENT_ID = '1bxid64Mup7aczewSAYMX'

/** Official square icon of a vendor, by domain; a lettermark when it has none. */
export function competitorLogoUrl(domain: string): string {
  return `https://cdn.brandfetch.io/${domain}/w/128/h/128/fallback/lettermark/icon?c=${BRANDFETCH_CLIENT_ID}`
}

/** Converts list cents to BRL cents with the catalog's fixed rate. */
export function toBrlCents(
  cents: number,
  currency: Currency,
  usdBrl: number,
): number {
  return currency === 'BRL' ? cents : Math.round(cents * usdBrl)
}

/** Monthly list price of a plan in its own currency, or `null` when free or on request. */
function paidMonthlyCents(price: ListPrice): number | null {
  switch (price.kind) {
    case 'per-seat':
    case 'flat':
      return price.cents > 0 ? price.cents : null
    case 'per-seat-range':
      return price.minCents > 0 ? price.minCents : null
    case 'quote':
      return null
  }
}

export interface CalculatorCost {
  /** Plan the cost was computed with: the vendor's cheapest paid plan. */
  plan: CompetitorPlan
  /** Account-wide price (does not grow with the team). */
  perAccount: boolean
  /** Yearly cost in BRL cents. */
  yearlyBrlCents: number
}

/**
 * Yearly cost of a competitor for `seats` users, on its cheapest paid plan
 * with a public price, converted to BRL. `null` when no plan has one.
 * Catalog plans are listed cheapest first; a range counts at its minimum.
 */
export function competitorYearlyCost(
  competitor: Competitor,
  seats: number,
  usdBrl: number,
): CalculatorCost | null {
  for (const plan of competitor.plans) {
    const monthly = paidMonthlyCents(plan.price)
    if (monthly === null) continue
    const perAccount = plan.price.kind === 'flat'
    const yearly = monthly * 12 * (perAccount ? 1 : seats)
    return {
      plan,
      perAccount,
      yearlyBrlCents: toBrlCents(yearly, competitor.currency, usdBrl),
    }
  }
  return null
}

/** Steel Pro on annual billing: one seat covers the three modules. */
export function steelYearlyCost(seats: number): number {
  return (PLAN_PRICES.PRO?.yearly ?? 0) * seats
}
