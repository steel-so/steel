/**
 * Results of a site A/B test (s4-ab): conversion rate, uplift over the
 * control and the Bayesian probability that a variant beats the control,
 * with Beta(1 + conversions, 1 + visitors − conversions) posteriors
 * (uniform prior). Exact sum (Evan Miller's closed form) while it is cheap,
 * a normal approximation of the posteriors beyond that.
 */

/** Below these, the results page says "ainda sem dados suficientes". */
export const MIN_VISITORS_PER_VARIANT = 100
export const MIN_TOTAL_CONVERSIONS = 10
/** Probability a variant must reach to be called the winner. */
export const WIN_PROBABILITY = 0.95
/** Above this many successes the exact sum gives way to the approximation. */
export const EXACT_LIMIT = 5000

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
]

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let a = 0.99999999999980993
  const t = z + 7.5
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 on erf, |ε| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * P(rate of B > rate of A) given each one's conversions and visitors.
 */
export function probabilityToBeat(
  control: { conversions: number; visitors: number },
  variant: { conversions: number; visitors: number },
): number {
  const alphaA = 1 + control.conversions
  const betaA = 1 + Math.max(0, control.visitors - control.conversions)
  const alphaB = 1 + variant.conversions
  const betaB = 1 + Math.max(0, variant.visitors - variant.conversions)

  if (alphaB <= EXACT_LIMIT) {
    let total = 0
    const base = logBeta(alphaA, betaA)
    for (let i = 0; i < alphaB; i++) {
      total += Math.exp(
        logBeta(alphaA + i, betaA + betaB) -
          Math.log(betaB + i) -
          logBeta(1 + i, betaB) -
          base,
      )
    }
    return clamp01(total)
  }

  const moments = (alpha: number, beta: number) => {
    const n = alpha + beta
    return { mean: alpha / n, variance: (alpha * beta) / (n * n * (n + 1)) }
  }
  const a = moments(alphaA, betaA)
  const b = moments(alphaB, betaB)
  return clamp01(
    normalCdf((b.mean - a.mean) / Math.sqrt(a.variance + b.variance)),
  )
}

export interface VariantCounts {
  key: string
  visitors: number
  conversions: number
}

export interface VariantResult extends VariantCounts {
  /** conversions / visitors (0–1); 0 without visitors. */
  rate: number
  /** Relative change of the rate over the control; `null` for the control
   * or when the control has no conversions. */
  uplift: number | null
  /** P(this variant beats the control); `null` for the control. */
  probabilityToBeat: number | null
}

export interface ExperimentResults {
  variants: VariantResult[]
  /** Enough visitors and conversions to read the probabilities. */
  enoughData: boolean
  /** Variant called the winner (the control when every challenger very
   * probably loses); `null` while undecided. */
  winner: string | null
  totals: { visitors: number; conversions: number }
}

/** Results of a test. The first entry of `counts` is the control. */
export function experimentResults(counts: VariantCounts[]): ExperimentResults {
  const control = counts[0]
  const variants = counts.map((count, index): VariantResult => {
    const rate = count.visitors > 0 ? count.conversions / count.visitors : 0
    if (index === 0 || !control) {
      return { ...count, rate, uplift: null, probabilityToBeat: null }
    }
    const controlRate =
      control.visitors > 0 ? control.conversions / control.visitors : 0
    return {
      ...count,
      rate,
      uplift: controlRate > 0 ? (rate - controlRate) / controlRate : null,
      probabilityToBeat: probabilityToBeat(control, count),
    }
  })

  const totals = counts.reduce(
    (sum, count) => ({
      visitors: sum.visitors + count.visitors,
      conversions: sum.conversions + count.conversions,
    }),
    { visitors: 0, conversions: 0 },
  )
  const enoughData =
    counts.length > 1 &&
    counts.every((count) => count.visitors >= MIN_VISITORS_PER_VARIANT) &&
    totals.conversions >= MIN_TOTAL_CONVERSIONS

  let winner: string | null = null
  if (enoughData) {
    const challengers = variants.slice(1)
    const best = challengers.reduce((top, item) =>
      (item.probabilityToBeat ?? 0) > (top.probabilityToBeat ?? 0) ? item : top,
    )
    if ((best.probabilityToBeat ?? 0) >= WIN_PROBABILITY) {
      winner = best.key
    } else if (
      challengers.every(
        (item) => (item.probabilityToBeat ?? 1) <= 1 - WIN_PROBABILITY,
      )
    ) {
      winner = variants[0].key
    }
  }

  return { variants, enoughData, winner, totals }
}
