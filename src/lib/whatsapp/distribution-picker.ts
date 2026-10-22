/**
 * Who receives the next conversation of the queue (ADR 0047). Pure rules —
 * loading the candidates and writing the assignment live in
 * `src/services/whatsapp-distribution.service.ts`, which runs this inside a
 * per-scope lock so two messages arriving together never see the same state.
 */

export type WhatsAppDistributionPickMode = 'ROUND_ROBIN' | 'LEAST_LOADED'

export interface DistributionCandidate {
  userId: string
  /** Open conversations (not closed, archived or deleted) assigned to them. */
  openCount: number
  /** Presence is AVAILABLE (a person with no presence row counts as such). */
  available: boolean
  /** Last conversation received through the distribution; null = never. */
  lastAssignedAt: Date | null
}

export interface DistributionPickInput {
  mode: WhatsAppDistributionPickMode
  candidates: DistributionCandidate[]
  /** Open-conversation ceiling per agent; null = unlimited. */
  maxOpenPerAgent: number | null
  /** Skip agents whose presence is AWAY. */
  onlyAvailable: boolean
  /** Round-robin pointer: who got the previous conversation of this scope. */
  lastAssignedUserId: string | null
}

export type DistributionSkipReason =
  /** Nobody can receive conversations in this scope. */
  | 'empty_pool'
  /** Everyone is away. */
  | 'nobody_available'
  /** Everyone available is at the open-conversation ceiling. */
  | 'all_at_capacity'

export type DistributionPick =
  | { userId: string }
  | { userId: null; reason: DistributionSkipReason }

function byOldestAssignment(
  a: DistributionCandidate,
  b: DistributionCandidate,
): number {
  const left = a.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  const right = b.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  if (left !== right) return left < right ? -1 : 1
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

/** Drops repeated users (keeps the first) so a double entry never skews turns. */
function unique(candidates: DistributionCandidate[]): DistributionCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.userId)) return false
    seen.add(candidate.userId)
    return true
  })
}

export function pickAssignee(input: DistributionPickInput): DistributionPick {
  const pool = unique(input.candidates)
  if (pool.length === 0) return { userId: null, reason: 'empty_pool' }

  const present = input.onlyAvailable
    ? pool.filter((candidate) => candidate.available)
    : pool
  if (present.length === 0) return { userId: null, reason: 'nobody_available' }

  const eligible =
    input.maxOpenPerAgent === null
      ? present
      : present.filter(
          (candidate) => candidate.openCount < (input.maxOpenPerAgent ?? 0),
        )
  if (eligible.length === 0) return { userId: null, reason: 'all_at_capacity' }

  if (input.mode === 'LEAST_LOADED') {
    const [winner] = [...eligible].sort(
      (a, b) => a.openCount - b.openCount || byOldestAssignment(a, b),
    )
    return { userId: winner.userId }
  }

  // Round-robin over a stable order (by id): the next eligible agent after
  // the pointer, wrapping around. An agent who left the pool, or is skipped
  // this turn, simply moves the pointer on to whoever follows.
  const ordered = [...eligible].sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
  )
  const pointer = input.lastAssignedUserId
  const next =
    pointer === null
      ? ordered[0]
      : (ordered.find((candidate) => candidate.userId > pointer) ?? ordered[0])
  return { userId: next.userId }
}
