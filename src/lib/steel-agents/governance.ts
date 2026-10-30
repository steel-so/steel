/** Pure metrics of the governance panel (A6). */

export interface DecisionCounts {
  executed: number
  failed: number
  rejected: number
  expired: number
  pending: number
}

export const EMPTY_DECISIONS: DecisionCounts = {
  executed: 0,
  failed: 0,
  rejected: 0,
  expired: 0,
  pending: 0,
}

/**
 * Approval and rejection rates over the actions a human decided. An action
 * the human approved counts as approved even if its execution then failed;
 * expired ones were never decided and stay out of both rates.
 */
export function decisionRates(counts: DecisionCounts): {
  approved: number
  decided: number
  approvalRate: number | null
  rejectionRate: number | null
} {
  const approved = counts.executed + counts.failed
  const decided = approved + counts.rejected
  return {
    approved,
    decided,
    approvalRate: decided === 0 ? null : approved / decided,
    rejectionRate: decided === 0 ? null : counts.rejected / decided,
  }
}

export function costPerApplied(
  costUsd: number,
  applied: number,
): number | null {
  if (applied <= 0) return null
  return costUsd / applied
}

/** Window of the panel, in days. */
export const GOVERNANCE_DEFAULT_DAYS = 30
export const GOVERNANCE_MAX_DAYS = 365

export function governanceSince(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60_000)
}

/** Spreadsheet formula injection: a cell must not start with these. */
export function safeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
