export type CrmCadenceStatusDTO = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type CrmCadenceStepTypeDTO = 'EMAIL' | 'WHATSAPP' | 'TASK'
export type CrmCadenceDelayUnitDTO = 'MINUTES' | 'HOURS' | 'DAYS'
export type CrmCadenceEnrollmentStatusDTO =
  | 'ACTIVE'
  | 'PAUSED'
  | 'REPLIED'
  | 'COMPLETED'
  | 'STOPPED'
export type CrmCadenceStopReasonDTO =
  | 'REPLIED'
  | 'MANUAL'
  | 'LEAD_CLOSED'
  | 'LEAD_DELETED'
  | 'NO_CONTACT'
  | 'CADENCE_ARCHIVED'
export type CrmCadenceRunStatusDTO = 'SENT' | 'SKIPPED' | 'FAILED'

export interface CrmCadenceStepDTO {
  id: string
  position: number
  type: CrmCadenceStepTypeDTO
  delayValue: number
  delayUnit: CrmCadenceDelayUnitDTO
  subject: string | null
  body: string
  whatsappTemplateId: string | null
  templateVariables: string[]
}

export interface CrmCadenceStatsDTO {
  enrolled: number
  active: number
  paused: number
  replied: number
  completed: number
  stopped: number
  /** Share of enrollments that ended with a reply (0..1). */
  replyRate: number
  /** Sent messages per step position. */
  sentByStep: { position: number; sent: number; failed: number }[]
}

export interface CrmCadenceDTO {
  id: string
  workspaceId: string
  name: string
  description: string | null
  status: CrmCadenceStatusDTO
  emailFrom: string | null
  emailReplyTo: string | null
  whatsappConnectionId: string | null
  stopOnReply: boolean
  windowStartHour: number | null
  windowEndHour: number | null
  weekdaysOnly: boolean
  steps: CrmCadenceStepDTO[]
  stats: CrmCadenceStatsDTO | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface CrmCadenceRunDTO {
  id: string
  stepId: string | null
  position: number
  type: CrmCadenceStepTypeDTO
  status: CrmCadenceRunStatusDTO
  detail: string | null
  createdAt: string
}

export interface CrmCadenceEnrollmentDTO {
  id: string
  workspaceId: string
  cadenceId: string
  cadenceName: string | null
  leadId: string
  leadName: string | null
  status: CrmCadenceEnrollmentStatusDTO
  nextPosition: number
  totalSteps: number | null
  nextRunAt: string | null
  stopReason: CrmCadenceStopReasonDTO | null
  repliedVia: string | null
  enrolledById: string
  enrolledAt: string
  finishedAt: string | null
  runs: CrmCadenceRunDTO[]
}

export interface CrmCadenceEnrollResultDTO {
  enrolled: CrmCadenceEnrollmentDTO[]
  skipped: { leadId: string; reason: string }[]
}
