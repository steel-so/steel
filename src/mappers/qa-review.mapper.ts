import type { QaCriterion, QaReview, QaReviewConfig } from '@prisma/client'
import { DEFAULT_QA_CRITERIA } from '@/src/lib/qa/criteria'
import type {
  QaConfigDTO,
  QaCoachingAgentDTO,
  QaCoachingDTO,
  QaCoachingTipDTO,
  QaCoachingTrendDTO,
  QaCriterionDTO,
  QaCriterionResultDTO,
  QaReviewDTO,
} from '@/types/qa-review'

export const QA_DEFAULT_CONFIG = {
  enabled: false,
  reviewConversations: true,
  reviewTickets: true,
  includeBots: true,
  minMessages: 4,
  lowScoreThreshold: 60,
  alertLowScore: true,
} as const

/** Tips shown per agent and reviews listed as "worst" in the panel. */
const TOP_TIPS = 5
const LOWEST_REVIEWS = 5
const BOT_LABEL = 'Bot / sem responsável'

export function toQaCriterionDTO(row: QaCriterion): QaCriterionDTO {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    weight: row.weight,
    appliesTo: row.appliesTo,
    active: row.active,
    position: row.position,
  }
}

export function toQaConfigDTO(
  row: QaReviewConfig | null,
  criteria: QaCriterion[],
): QaConfigDTO {
  return {
    enabled: row?.enabled ?? QA_DEFAULT_CONFIG.enabled,
    reviewConversations:
      row?.reviewConversations ?? QA_DEFAULT_CONFIG.reviewConversations,
    reviewTickets: row?.reviewTickets ?? QA_DEFAULT_CONFIG.reviewTickets,
    includeBots: row?.includeBots ?? QA_DEFAULT_CONFIG.includeBots,
    minMessages: row?.minMessages ?? QA_DEFAULT_CONFIG.minMessages,
    lowScoreThreshold:
      row?.lowScoreThreshold ?? QA_DEFAULT_CONFIG.lowScoreThreshold,
    alertLowScore: row?.alertLowScore ?? QA_DEFAULT_CONFIG.alertLowScore,
    criteria:
      criteria.length > 0
        ? criteria.map(toQaCriterionDTO)
        : DEFAULT_QA_CRITERIA.map((criterion) => ({ ...criterion })),
  }
}

function parseResults(value: unknown): QaCriterionResultDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    if (typeof r.key !== 'string' || typeof r.score !== 'number') return []
    return [
      {
        key: r.key,
        name: typeof r.name === 'string' ? r.name : r.key,
        weight: typeof r.weight === 'number' ? r.weight : 1,
        score: r.score,
        evidence: typeof r.evidence === 'string' ? r.evidence : '',
      },
    ]
  })
}

function parseTips(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((tip): tip is string => typeof tip === 'string')
}

export function toQaReviewDTO(row: QaReview): QaReviewDTO {
  return {
    id: row.id,
    subjectType: row.subjectType,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    subjectLabel: row.subjectLabel,
    status: row.status,
    handlerKind: row.handlerKind,
    agentUserId: row.agentUserId,
    agentName: row.agentName,
    customerName: row.customerName,
    score: row.score,
    summary: row.summary,
    criteriaResults: parseResults(row.criteriaResults),
    coachingTips: parseTips(row.coachingTips),
    lowScore: row.lowScore,
    skipReason: row.skipReason,
    subjectEndedAt: row.subjectEndedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

/** Monday 00:00 UTC of the week of `date`. */
export function weekStartOf(date: Date): Date {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const sinceMonday = (start.getUTCDay() + 6) % 7
  start.setUTCDate(start.getUTCDate() - sinceMonday)
  return start
}

function buildTrend(reviews: QaReviewDTO[]): QaCoachingTrendDTO[] {
  const weeks = new Map<string, number[]>()
  for (const review of reviews) {
    if (review.score === null || !review.reviewedAt) continue
    const key = weekStartOf(new Date(review.reviewedAt)).toISOString()
    const scores = weeks.get(key) ?? []
    scores.push(review.score)
    weeks.set(key, scores)
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, scores]) => ({
      weekStart,
      average: mean(scores) ?? 0,
      reviews: scores.length,
    }))
}

function buildTips(reviews: QaReviewDTO[]): QaCoachingTipDTO[] {
  const counts = new Map<string, QaCoachingTipDTO>()
  for (const review of reviews) {
    for (const tip of review.coachingTips) {
      const key = tip.trim().toLowerCase()
      const found = counts.get(key)
      if (found) found.count++
      else counts.set(key, { tip: tip.trim(), count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tip.localeCompare(b.tip))
    .slice(0, TOP_TIPS)
}

function buildAgent(
  agentUserId: string | null,
  reviews: QaReviewDTO[],
): QaCoachingAgentDTO {
  const scored = reviews.filter((r) => r.score !== null)
  const criteria = new Map<string, { name: string; scores: number[] }>()
  for (const review of scored) {
    for (const result of review.criteriaResults) {
      const entry = criteria.get(result.key) ?? {
        name: result.name,
        scores: [],
      }
      entry.scores.push(result.score)
      criteria.set(result.key, entry)
    }
  }
  const byCriterion = [...criteria.entries()]
    .map(([key, value]) => ({
      key,
      name: value.name,
      average: mean(value.scores) ?? 0,
    }))
    .sort((a, b) => a.average - b.average || a.key.localeCompare(b.key))
  const named = reviews.find((r) => r.agentName)?.agentName
  return {
    agentUserId,
    agentName: agentUserId ? (named ?? 'Atendente removido') : BOT_LABEL,
    reviews: scored.length,
    averageScore: mean(scored.map((r) => r.score as number)) ?? 0,
    lowScoreCount: scored.filter((r) => r.lowScore).length,
    byCriterion,
    weakestCriterion: byCriterion[0] ?? null,
    trend: buildTrend(scored),
    topTips: buildTips(scored),
    lowest: [...scored]
      .sort((a, b) => (a.score as number) - (b.score as number))
      .slice(0, LOWEST_REVIEWS),
  }
}

/**
 * Coaching panel: completed reviews grouped by agent, worst average first
 * (who needs help sits on top). Attendances without a human owner are one
 * "Bot" row.
 */
export function buildQaCoaching(
  rows: QaReviewDTO[],
  range: { from: Date; to: Date },
): QaCoachingDTO {
  const scored = rows.filter((r) => r.score !== null)
  const byAgent = new Map<string | null, QaReviewDTO[]>()
  for (const review of scored) {
    const list = byAgent.get(review.agentUserId) ?? []
    list.push(review)
    byAgent.set(review.agentUserId, list)
  }
  const agents = [...byAgent.entries()]
    .map(([agentUserId, list]) => buildAgent(agentUserId, list))
    .sort(
      (a, b) =>
        a.averageScore - b.averageScore ||
        a.agentName.localeCompare(b.agentName),
    )
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    reviews: scored.length,
    averageScore: mean(scored.map((r) => r.score as number)),
    lowScoreCount: scored.filter((r) => r.lowScore).length,
    humanAverage: mean(
      scored
        .filter((r) => r.handlerKind !== 'BOT')
        .map((r) => r.score as number),
    ),
    botAverage: mean(
      scored
        .filter((r) => r.handlerKind === 'BOT')
        .map((r) => r.score as number),
    ),
    agents,
  }
}
