import type {
  AiEvalRunReason,
  AiEvalTargetKey,
  AiFeedbackRatingKey,
  AiFeedbackReason,
  AiFeedbackSurfaceKey,
} from '@/src/lib/ai/quality-labels'
import type { AiUsagePeriodPreset, AiUsageScope } from './ai-usage'

/**
 * Steel AI quality (ADR 0039): feedback on AI answers, the quality panel in
 * Análises and the eval sets. Days are UTC like the usage pages.
 */

export interface AiFeedbackDTO {
  id: string
  surface: AiFeedbackSurfaceKey
  targetId: string
  variant: string
  rating: AiFeedbackRatingKey
  reason: AiFeedbackReason | null
  comment: string | null
  modelKey: string | null
  createdAt: string
  updatedAt: string
}

export interface AiQualityTotalsDTO {
  up: number
  down: number
  total: number
  /** up ÷ total; `null` without feedback. */
  approvalRate: number | null
}

export interface AiQualityBreakdownItemDTO extends AiQualityTotalsDTO {
  key: string
  label: string
}

export interface AiQualityDailyPointDTO {
  /** `YYYY-MM-DD` (UTC). */
  date: string
  up: number
  down: number
  approvalRate: number | null
}

export interface AiQualityResolutionItemDTO {
  /** Conversations the AI handled in the period. */
  handled: number
  /** Of those, resolved with no human (closed with no agent message / resolved by the KB). */
  resolved: number
  /** resolved ÷ handled; `null` when nothing was handled. */
  rate: number | null
  /** AI cost of the feature in the period (US$). */
  costUsd: number
  /** costUsd ÷ resolved; `null` with no resolution. */
  costPerResolutionUsd: number | null
}

export interface AiQualityResolutionDTO {
  whatsapp: AiQualityResolutionItemDTO
  servicedesk: AiQualityResolutionItemDTO
  total: AiQualityResolutionItemDTO
}

/** Where a rated answer lives, for the UI to build the link. */
export type AiQualityLinkDTO =
  | { kind: 'chat'; conversationId: string }
  | { kind: 'agent_run'; agentId: string; runId: string }
  | { kind: 'ticket'; ticketNumber: number }
  | { kind: 'kb_article'; articleId: string }
  | { kind: 'whatsapp'; conversationId: string }

export interface AiQualityWorstItemDTO {
  id: string
  surface: AiFeedbackSurfaceKey
  surfaceLabel: string
  variant: string
  reason: AiFeedbackReason | null
  reasonLabel: string | null
  comment: string | null
  modelKey: string | null
  modelLabel: string | null
  /** Who rated (workspace scope only; `null` in the personal view). */
  userName: string | null
  createdAt: string
  /** Null when the answer is gone or not openable by the viewer. */
  link: AiQualityLinkDTO | null
}

export interface AiQualityDTO {
  scope: AiUsageScope
  period: AiUsagePeriodPreset
  from: string
  /** Exclusive. */
  to: string
  canViewWorkspace: boolean
  totals: AiQualityTotalsDTO
  bySurface: AiQualityBreakdownItemDTO[]
  byModel: AiQualityBreakdownItemDTO[]
  daily: AiQualityDailyPointDTO[]
  /** Workspace scope only (the personal view has no resolutions). */
  resolution: AiQualityResolutionDTO | null
  /** Most recent thumbs down, newest first (up to 20). */
  worst: AiQualityWorstItemDTO[]
}

// ─── Eval sets ───────────────────────────────────────────────────────────────

export type AiEvalRunStatusDTO = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

export interface AiEvalCaseDTO {
  id: string
  input: string
  expected: string | null
  criteria: string | null
  mustContain: string[]
  mustNotContain: string[]
  sourceMessageId: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export interface AiEvalRunDTO {
  id: string
  setId: string
  status: AiEvalRunStatusDTO
  modelKey: string | null
  modelLabel: string | null
  judgeModelKey: string | null
  skillId: string | null
  hasPromptOverride: boolean
  reason: AiEvalRunReason
  startedBy: { id: string; name: string } | null
  caseCount: number
  passedCount: number
  failedCount: number
  /** passed ÷ caseCount once done; `null` before. */
  passRate: number | null
  avgScore: number | null
  costUsd: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface AiEvalResultDTO {
  id: string
  caseId: string | null
  input: string
  output: string
  passed: boolean
  checksPassed: boolean
  failedChecks: string[]
  judgeScore: number | null
  judgePassed: boolean | null
  judgeRationale: string | null
  costUsd: number
  error: string | null
}

export interface AiEvalRunDetailDTO extends AiEvalRunDTO {
  results: AiEvalResultDTO[]
}

export interface AiEvalSetDTO {
  id: string
  name: string
  description: string | null
  target: AiEvalTargetKey
  targetLabel: string
  skillId: string | null
  caseCount: number
  lastRun: AiEvalRunDTO | null
  createdAt: string
  updatedAt: string
}

export interface AiEvalSetDetailDTO extends AiEvalSetDTO {
  cases: AiEvalCaseDTO[]
}
