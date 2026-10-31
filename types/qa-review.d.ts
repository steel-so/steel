export type QaSubjectTypeDTO = 'CONVERSATION' | 'TICKET'
export type QaReviewStatusDTO = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'FAILED'
export type QaHandlerKindDTO = 'HUMAN' | 'BOT' | 'MIXED'
export type QaCriterionScopeDTO = 'BOTH' | 'CONVERSATION' | 'TICKET'

export interface QaCriterionDTO {
  key: string
  name: string
  description: string
  weight: number
  appliesTo: QaCriterionScopeDTO
  active: boolean
  position: number
}

export interface QaConfigDTO {
  enabled: boolean
  reviewConversations: boolean
  reviewTickets: boolean
  includeBots: boolean
  minMessages: number
  lowScoreThreshold: number
  alertLowScore: boolean
  criteria: QaCriterionDTO[]
}

export interface QaCriterionResultDTO {
  key: string
  name: string
  weight: number
  /** 0-100 */
  score: number
  evidence: string
}

export interface QaReviewDTO {
  id: string
  subjectType: QaSubjectTypeDTO
  conversationId: string | null
  ticketId: string | null
  subjectLabel: string | null
  status: QaReviewStatusDTO
  handlerKind: QaHandlerKindDTO | null
  agentUserId: string | null
  agentName: string | null
  customerName: string | null
  score: number | null
  summary: string | null
  criteriaResults: QaCriterionResultDTO[]
  coachingTips: string[]
  lowScore: boolean
  skipReason: string | null
  subjectEndedAt: string | null
  reviewedAt: string | null
  createdAt: string
}

export interface QaReviewListDTO {
  items: QaReviewDTO[]
  nextCursor: string | null
}

export interface QaCoachingCriterionDTO {
  key: string
  name: string
  average: number
}

export interface QaCoachingTrendDTO {
  /** ISO date (UTC) of the Monday that starts the week. */
  weekStart: string
  average: number
  reviews: number
}

export interface QaCoachingTipDTO {
  tip: string
  count: number
}

export interface QaCoachingAgentDTO {
  /** null = attendances with no human owner (bot only). */
  agentUserId: string | null
  agentName: string
  reviews: number
  averageScore: number
  lowScoreCount: number
  byCriterion: QaCoachingCriterionDTO[]
  weakestCriterion: QaCoachingCriterionDTO | null
  trend: QaCoachingTrendDTO[]
  topTips: QaCoachingTipDTO[]
  /** Lowest-scored reviews of the period, worst first. */
  lowest: QaReviewDTO[]
}

export interface QaCoachingDTO {
  from: string
  to: string
  reviews: number
  averageScore: number | null
  lowScoreCount: number
  humanAverage: number | null
  botAverage: number | null
  agents: QaCoachingAgentDTO[]
}
