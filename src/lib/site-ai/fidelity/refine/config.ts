/**
 * Knobs of the render-and-compare refinement (ADR 0072), from the
 * `FIDELITY_*` environment variables.
 */

export const DEFAULT_MAX_ROUNDS = 3
export const DEFAULT_TARGET_SCORE = 85
/** Extra time after the drawing budget (`FIDELITY_BUDGET_MS`, 20 min). */
export const DEFAULT_REFINE_BUDGET_MINUTES = 25

export interface RefineConfig {
  /** Fix cycles; 0 turns the refinement off. */
  maxRounds: number
  /** A section at or above this similarity (0-100) is left alone. */
  targetScore: number
  budgetMs: number
}

function whole(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function resolveRefineConfig(raw: {
  maxRounds?: unknown
  targetScore?: unknown
  budgetMinutes?: unknown
}): RefineConfig {
  return {
    maxRounds: whole(raw.maxRounds, DEFAULT_MAX_ROUNDS, 0, 6),
    targetScore: whole(raw.targetScore, DEFAULT_TARGET_SCORE, 50, 100),
    budgetMs:
      whole(raw.budgetMinutes, DEFAULT_REFINE_BUDGET_MINUTES, 1, 60) * 60_000,
  }
}
