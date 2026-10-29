/**
 * Subject A/B test of a newsletter issue (newsletter2 nl2-digest-ai): the
 * test share of the audience is split half A, half B; after the wait the
 * variant with the better open (or click) rate wins and the held rest of
 * the audience gets it. Ties keep A, the original subject.
 */

export type AbVariant = 'A' | 'B'
export type AbMetric = 'OPENS' | 'CLICKS'

export type AbVariantCounts = {
  variant: AbVariant
  recipients: number
  sent: number
  opened: number
  clicked: number
}

/** Recipients in the test share (both variants), at least 2. */
export function abShareSize(audience: number, percent: number): number {
  return Math.min(audience, Math.max(2, Math.round((audience * percent) / 100)))
}

/** Rate of the metric over the sent e-mails (0 when nothing went out). */
export function abRate(counts: AbVariantCounts, metric: AbMetric): number {
  if (counts.sent <= 0) return 0
  return (metric === 'OPENS' ? counts.opened : counts.clicked) / counts.sent
}

export function pickAbWinner(
  variants: AbVariantCounts[],
  metric: AbMetric,
): AbVariant {
  const a = variants.find((v) => v.variant === 'A')
  const b = variants.find((v) => v.variant === 'B')
  if (!b) return 'A'
  if (!a) return 'B'
  return abRate(b, metric) > abRate(a, metric) ? 'B' : 'A'
}

/** When the winner is picked: start of sending + the wait. */
export function abDecideAt(startedAt: Date, waitHours: number): Date {
  return new Date(startedAt.getTime() + waitHours * 3_600_000)
}
