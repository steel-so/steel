import type { SteelAgentToolMode } from '@prisma/client'

/**
 * Pure rules of Steel Agent versions (A2): what counts as a versioned change,
 * the eval gate and the A/B traffic split. No I/O.
 */

export interface VersionTool {
  toolName: string
  mode: SteelAgentToolMode
}

/** The part of an agent that is versioned and gated. */
export interface VersionContent {
  instructions: string
  maxToolRounds: number
  tools: VersionTool[]
}

/** Smallest and largest challenger share (the rest stays on the published). */
export const MIN_ROLLOUT_PERCENT = 1
export const MAX_ROLLOUT_PERCENT = 99

const MODES: readonly string[] = ['AUTO', 'APPROVAL']

/** Tools sorted by name, so two lists compare regardless of order. */
export function normalizeVersionTools(tools: VersionTool[]): VersionTool[] {
  return [...tools].sort((a, b) => a.toolName.localeCompare(b.toolName))
}

/** Reads the `tools` JSON column defensively (bad rows become empty). */
export function parseVersionTools(raw: unknown): VersionTool[] {
  if (!Array.isArray(raw)) return []
  const out: VersionTool[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { toolName, mode } = item as { toolName?: unknown; mode?: unknown }
    if (typeof toolName !== 'string' || typeof mode !== 'string') continue
    if (!MODES.includes(mode)) continue
    out.push({ toolName, mode: mode as SteelAgentToolMode })
  }
  return normalizeVersionTools(out)
}

/** Whether `next` differs from `current` in anything that is versioned. */
export function versionContentChanged(
  current: VersionContent,
  next: VersionContent,
): boolean {
  if (current.instructions !== next.instructions) return true
  if (current.maxToolRounds !== next.maxToolRounds) return true
  const a = normalizeVersionTools(current.tools)
  const b = normalizeVersionTools(next.tools)
  if (a.length !== b.length) return true
  return a.some(
    (tool, index) =>
      tool.toolName !== b[index].toolName || tool.mode !== b[index].mode,
  )
}

export interface EvalGateOutcome {
  passed: boolean
  total: number
  passedCases: number
  /** 0..1; 0 when nothing was graded. */
  rate: number
}

/** The gate: enough cases graded and a pass rate >= the agent's minimum. */
export function evaluateGate(input: {
  passedCases: number
  failedCases: number
  minPassRate: number
}): EvalGateOutcome {
  const total = input.passedCases + input.failedCases
  const rate = total === 0 ? 0 : input.passedCases / total
  return {
    passed: total > 0 && rate + 1e-9 >= input.minPassRate,
    total,
    passedCases: input.passedCases,
    rate,
  }
}

/**
 * Version a new run goes to. `random` is injectable (0 <= r < 1) so the split
 * is testable; the challenger gets `percent`% of the runs.
 */
export function pickVersionId(input: {
  publishedId: string | null
  challenger: { id: string; percent: number } | null
  random?: () => number
}): string | null {
  const { challenger } = input
  if (challenger) {
    const roll = (input.random ?? Math.random)() * 100
    if (roll < challenger.percent) return challenger.id
  }
  return input.publishedId
}

export interface VersionRunRow {
  versionId: string
  status: string
  costUsd: number
  rounds: number
}

export interface VersionApprovalRow {
  versionId: string
  status: string
}

export interface VersionStats {
  runs: number
  succeeded: number
  failed: number
  skipped: number
  /** Share of finished runs (SUCCEEDED + FAILED) that succeeded; null if none. */
  successRate: number | null
  avgCostUsd: number | null
  avgRounds: number | null
  approvalsDecided: number
  approvalsApproved: number
  /** Approved / (approved + rejected + expired); null if none decided. */
  approvalRate: number | null
}

const EMPTY_STATS: VersionStats = {
  runs: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  successRate: null,
  avgCostUsd: null,
  avgRounds: null,
  approvalsDecided: 0,
  approvalsApproved: 0,
  approvalRate: null,
}

/** Per-version metrics of the A/B comparison. */
export function summarizeVersionStats(
  runs: VersionRunRow[],
  approvals: VersionApprovalRow[],
): Map<string, VersionStats> {
  const acc = new Map<
    string,
    { stats: VersionStats; cost: number; rounds: number; counted: number }
  >()
  const slot = (id: string) => {
    let entry = acc.get(id)
    if (!entry) {
      entry = { stats: { ...EMPTY_STATS }, cost: 0, rounds: 0, counted: 0 }
      acc.set(id, entry)
    }
    return entry
  }
  for (const run of runs) {
    const entry = slot(run.versionId)
    entry.stats.runs++
    if (run.status === 'SUCCEEDED') entry.stats.succeeded++
    else if (run.status === 'FAILED') entry.stats.failed++
    else if (run.status === 'SKIPPED') entry.stats.skipped++
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') {
      entry.cost += run.costUsd
      entry.rounds += run.rounds
      entry.counted++
    }
  }
  for (const approval of approvals) {
    const entry = slot(approval.versionId)
    if (
      approval.status === 'EXECUTED' ||
      approval.status === 'FAILED' ||
      approval.status === 'CANCELED' ||
      approval.status === 'EXPIRED'
    ) {
      entry.stats.approvalsDecided++
      if (approval.status === 'EXECUTED' || approval.status === 'FAILED') {
        entry.stats.approvalsApproved++
      }
    }
  }
  const out = new Map<string, VersionStats>()
  for (const [id, { stats, cost, rounds, counted }] of acc) {
    const finished = stats.succeeded + stats.failed
    out.set(id, {
      ...stats,
      successRate: finished > 0 ? stats.succeeded / finished : null,
      avgCostUsd: counted > 0 ? cost / counted : null,
      avgRounds: counted > 0 ? rounds / counted : null,
      approvalRate:
        stats.approvalsDecided > 0
          ? stats.approvalsApproved / stats.approvalsDecided
          : null,
    })
  }
  return out
}

export function emptyVersionStats(): VersionStats {
  return { ...EMPTY_STATS }
}
