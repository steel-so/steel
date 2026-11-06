/** WhatsApp agent performance report ("tabulação", ADR 0062). */

export type WhatsAppAgentReportOutcome = 'SUCCESS' | 'FAILURE'

/** How much of the workspace the viewer sees in the report. */
export type WhatsAppAgentReportVisibility = 'ALL' | 'TEAMS' | 'SELF'

export interface WhatsAppAgentReportSettingsDTO {
  enabled: boolean
  /** `null` while nobody has ever saved the settings. */
  updatedAt: string | null
}

/** Conversations tabulated with one close status label. */
export interface WhatsAppAgentReportStatusCountDTO {
  label: string
  /** `null` when the status was removed or no longer matches the label. */
  outcome: WhatsAppAgentReportOutcome | null
  count: number
}

export interface WhatsAppAgentReportMetricsDTO {
  /** Conversations closed in the period (tabulated or not). */
  closed: number
  /** Closed with at least one close status (`success + failure`). */
  tabulated: number
  success: number
  failure: number
  /** `success / tabulated`, 0-100 with one decimal; `null` when nothing was tabulated. */
  successRate: number | null
  /** Closed without any close status. */
  untabulated: number
  /** Mean `createdAt` -> `closedAt` of the closed conversations, in seconds. */
  avgHandlingSeconds: number | null
  /** Conversations still open (not closed) right now. */
  open: number
  /** A conversation with several labels counts once in each. */
  byStatus: WhatsAppAgentReportStatusCountDTO[]
}

export interface WhatsAppAgentReportRowDTO
  extends WhatsAppAgentReportMetricsDTO {
  /** `null` = conversations closed without an assignee ("Sem atendente"). */
  agentId: string | null
  agentName: string
}

export interface WhatsAppAgentReportDTO {
  /** Inclusive first day, `YYYY-MM-DD` in America/Sao_Paulo. */
  fromDay: string
  /** Inclusive last day, `YYYY-MM-DD` in America/Sao_Paulo. */
  toDay: string
  timeZone: string
  teamId: string | null
  connectionId: string | null
  visibility: WhatsAppAgentReportVisibility
  rows: WhatsAppAgentReportRowDTO[]
  totals: WhatsAppAgentReportMetricsDTO
  /** Per-label summary of every row, most used first. */
  statuses: WhatsAppAgentReportStatusCountDTO[]
}
