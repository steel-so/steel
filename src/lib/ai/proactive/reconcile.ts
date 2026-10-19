import type { AiInsightStatus, ModuleKind } from '@prisma/client'
import type { AiInsightDraft } from './rules'

/**
 * Episode rule of the insights (ADR 0040), pure: what one evaluation of a
 * workspace does to the rows already there.
 *
 * - draft with no row → **create** (new episode);
 * - draft over an ACTIVE row → **refresh** (same episode, new numbers; the
 *   user's dismissal or snooze is kept);
 * - draft over a RESOLVED row → **reopen** (new episode: dismissal and
 *   snooze cleared, `firstSeenAt` reset);
 * - ACTIVE row of an evaluated module without a draft → **resolve**.
 *
 * Rows of a module that was not evaluated (it failed, or is disabled and
 * handled elsewhere) are never touched.
 */

export interface ExistingInsightRow {
  id: string
  userId: string
  dedupeKey: string
  module: ModuleKind
  status: AiInsightStatus
}

export interface InsightReconcilePlan {
  create: AiInsightDraft[]
  refresh: { id: string; draft: AiInsightDraft }[]
  reopen: { id: string; draft: AiInsightDraft }[]
  resolveIds: string[]
}

export function insightRowKey(userId: string, dedupeKey: string): string {
  return `${userId}\u0000${dedupeKey}`
}

export function planInsightReconcile(
  existing: ExistingInsightRow[],
  drafts: AiInsightDraft[],
  evaluatedModules: readonly ModuleKind[],
): InsightReconcilePlan {
  const evaluated = new Set(evaluatedModules)
  const rows = new Map(
    existing.map((row) => [insightRowKey(row.userId, row.dedupeKey), row]),
  )
  const plan: InsightReconcilePlan = {
    create: [],
    refresh: [],
    reopen: [],
    resolveIds: [],
  }

  const seen = new Set<string>()
  for (const draft of drafts) {
    if (!evaluated.has(draft.module)) continue
    const key = insightRowKey(draft.userId, draft.dedupeKey)
    // A rule emitting the same key twice for a user: the first one wins.
    if (seen.has(key)) continue
    seen.add(key)
    const row = rows.get(key)
    if (!row) plan.create.push(draft)
    else if (row.status === 'ACTIVE') plan.refresh.push({ id: row.id, draft })
    else plan.reopen.push({ id: row.id, draft })
  }

  for (const [key, row] of rows) {
    if (row.status !== 'ACTIVE' || !evaluated.has(row.module)) continue
    if (!seen.has(key)) plan.resolveIds.push(row.id)
  }
  return plan
}

/**
 * Dedupe keys that started an episode in this plan (created or reopened),
 * once per key — the Steel Agents `*.insight.detected` events fire per
 * condition, not per recipient.
 */
export function newEpisodes(plan: InsightReconcilePlan): AiInsightDraft[] {
  const byKey = new Map<string, AiInsightDraft>()
  for (const draft of [
    ...plan.create,
    ...plan.reopen.map((entry) => entry.draft),
  ]) {
    if (!byKey.has(draft.dedupeKey)) byKey.set(draft.dedupeKey, draft)
  }
  return [...byKey.values()]
}

/**
 * Steel Agents event of a new episode, or `null`. Only conditions whose
 * content is the same for every recipient fire an event — a department
 * queue, the CRM totals, one conversation's sentiment. Personal insights
 * ("seus chamados", "suas oportunidades") and the visibility-dependent
 * waiting queue do not: an agent would get one person's view of the data.
 */
export function agentEventFor(
  draft: AiInsightDraft,
):
  | 'sd.insight.detected'
  | 'crm.insight.detected'
  | 'zap.insight.detected'
  | null {
  const key = draft.dedupeKey
  if (key.startsWith('sd-breach:dept:')) return 'sd.insight.detected'
  if (
    key === 'crm-stale:all' ||
    key.startsWith('crm-stage:') ||
    key.startsWith('crm-forecast:')
  ) {
    return 'crm.insight.detected'
  }
  if (key.startsWith('zap-sentiment:')) return 'zap.insight.detected'
  return null
}
