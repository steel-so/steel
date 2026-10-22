export type WhatsAppSlaStateDTO = 'OK' | 'AT_RISK' | 'BREACHED'

export interface WhatsAppSlaPolicyDTO {
  id: string
  /** Null = the workspace default. */
  teamId: string | null
  teamName: string | null
  enabled: boolean
  firstResponseMinutes: number
  resolutionMinutes: number | null
  businessHoursOnly: boolean
  warnAtPercent: number
  countAiAsResponse: boolean
  notifyAssignee: boolean
  notifyTeamLeaders: boolean
  notifySupervisors: boolean
  supervisorIds: string[]
  notifyInApp: boolean
  notifyEmail: boolean
  createdAt: string
  updatedAt: string
}

/** One target (first response or resolution) of an open cycle. */
export interface WhatsAppSlaTargetDTO {
  dueAt: string
  warnAt: string
  /** First response only: when it happened (null while waiting). */
  doneAt: string | null
  state: WhatsAppSlaStateDTO
}

/** Open SLA cycle of a conversation, for the chip and the list filter. */
export interface WhatsAppSlaOpenCycleDTO {
  cycleId: string
  conversationId: string
  startedAt: string
  firstResponse: WhatsAppSlaTargetDTO
  resolution: WhatsAppSlaTargetDTO | null
  /** Worst state among the targets still running. */
  state: WhatsAppSlaStateDTO
}

export interface WhatsAppSlaBreakdownRowDTO {
  id: string | null
  label: string
  cycles: number
  breaches: number
}

export interface WhatsAppSlaReportDTO {
  from: string
  to: string
  timeZone: string
  teamId: string | null
  firstResponse: {
    /** Cycles whose first-response target was decided in the period. */
    evaluated: number
    withinTarget: number
    /** 0-100, null when nothing was evaluated. */
    withinPercent: number | null
    averageSeconds: number | null
    p90Seconds: number | null
  }
  resolution: {
    evaluated: number
    withinTarget: number
    withinPercent: number | null
  }
  byAgent: WhatsAppSlaBreakdownRowDTO[]
  byTeam: WhatsAppSlaBreakdownRowDTO[]
}
