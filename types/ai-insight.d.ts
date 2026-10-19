/**
 * Proactive AI (ADR 0040): insights feed and the daily digest settings.
 * Shared by the API (`/api/workspaces/[id]/ai/insights`), the hooks and the
 * `ws_insights` tool.
 */

export type AiInsightKindDTO =
  | 'SD_SLA_BREACH_FORECAST'
  | 'CRM_STALE_OPPORTUNITIES'
  | 'CRM_STALLED_STAGE'
  | 'CRM_FORECAST_GAP'
  | 'ZAP_WAITING_TOO_LONG'
  | 'ZAP_NEGATIVE_SENTIMENT'

export type AiInsightModuleDTO = 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'

export type AiInsightSeverityDTO = 'INFO' | 'WARNING' | 'CRITICAL'

/** Where the insight sits for its user right now. */
export type AiInsightStateDTO = 'active' | 'snoozed' | 'dismissed'

/** One number behind an insight ("Chamados": "3"). */
export interface AiInsightFactDTO {
  label: string
  value: string
}

export interface AiInsightDTO {
  id: string
  kind: AiInsightKindDTO
  module: AiInsightModuleDTO
  severity: AiInsightSeverityDTO
  /** pt-BR, with the numbers. */
  title: string
  /** pt-BR: why — the numbers behind it. */
  body: string
  facts: AiInsightFactDTO[]
  /** Path in the app (slug included), or `null`. */
  href: string | null
  /** Prefilled Steel AI question, or `null`. */
  prompt: string | null
  state: AiInsightStateDTO
  snoozedUntil: string | null
  /** Start of the current episode. */
  firstSeenAt: string
  /** Last time the worker confirmed the condition. */
  lastSeenAt: string
}

export interface AiInsightCountsDTO {
  active: number
  snoozed: number
  dismissed: number
}

export interface AiInsightFeedDTO {
  /** `false` when Steel AI or the proactive AI is off in the workspace. */
  enabled: boolean
  items: AiInsightDTO[]
  counts: AiInsightCountsDTO
}

export interface AiDigestSettingsDTO {
  inApp: boolean
  email: boolean
  /** `false` when the workspace turned the proactive AI off. */
  workspaceEnabled: boolean
}
