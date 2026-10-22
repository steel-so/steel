/** Percentile of a list of numbers by the nearest-rank method; `null` if empty. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

export interface LatencyStats {
  turns: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

/** What the session log reports for the latency acceptance step (ADR 0046). */
export function latencyStats(latenciesMs: readonly number[]): LatencyStats {
  return {
    turns: latenciesMs.length,
    p50Ms: percentile(latenciesMs, 50),
    p95Ms: percentile(latenciesMs, 95),
    maxMs: percentile(latenciesMs, 100),
  }
}
