import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'

export type AiProcedureStatusDTO = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type AiProcedureRunStatusDTO =
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'HANDED_OFF'
  | 'CANCELED'
export type AiProcedureRunSubjectDTO =
  | 'WHATSAPP_CONVERSATION'
  | 'STEEL_AGENT_RUN'
  | 'TEST'

export interface AiProcedureDTO {
  id: string
  name: string
  description: string | null
  whenToUse: string
  status: AiProcedureStatusDTO
  steps: ProcedureStep[]
  maxAttempts: number
  handoffMessage: string | null
  whatsappEnabled: boolean
  agentIds: string[]
  ownerId: string | null
  currentVersion: number
  /** Executions started in the current month (quota accounting). */
  runsThisMonth: number
  createdAt: string
  updatedAt: string
}

export interface AiProcedureVersionDTO {
  id: string
  number: number
  whenToUse: string
  steps: ProcedureStep[]
  maxAttempts: number
  handoffMessage: string | null
  changeNote: string | null
  createdById: string | null
  createdAt: string
  /** The version the procedure runs now. */
  current: boolean
}

export interface AiProcedureRunDTO {
  id: string
  procedureId: string
  procedureName: string
  versionNumber: number
  subjectType: AiProcedureRunSubjectDTO
  subjectId: string
  status: AiProcedureRunStatusDTO
  failureReason: string | null
  startedAt: string
  finishedAt: string | null
}

export interface AiProcedureRunStepDTO {
  id: string
  position: number
  stepKey: string
  kind: string
  title: string
  status: 'OK' | 'FAILED' | 'SKIPPED' | 'REJECTED'
  input: unknown
  output: unknown
  error: string | null
  createdAt: string
}

export interface AiProcedureRunDetailDTO extends AiProcedureRunDTO {
  steps: AiProcedureRunStepDTO[]
}

export interface AiProcedureCatalogDTO {
  validations: string[]
  operators: string[]
  /** READ tools a TOOL step may call. */
  tools: { name: string; label: string; description: string }[]
  agents: { id: string; name: string }[]
  presetVariables: string[]
  limits: { procedures: number; steps: number }
  canManage: boolean
}

export interface AiProcedurePreviewDTO {
  problems: string[]
  plan: {
    key: string
    title: string
    kind: ProcedureStep['kind']
    required: boolean
    applies: boolean
  }[]
}
