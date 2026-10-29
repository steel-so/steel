import type {
  AiActionKindDTO,
  AiModuleDTO,
  AiPendingActionDTO,
} from './steel-ai'

/**
 * Public contract of Steel Agents (`/api/workspaces/:id/agents/**`).
 * Agents run with the owner's permissions; each allowed tool is automatic or
 * requires approval (DELETE always requires approval).
 */

export type SteelAgentTriggerTypeDTO = 'SCHEDULE' | 'EVENT' | 'MANUAL'
export type SteelAgentToolModeDTO = 'AUTO' | 'APPROVAL'
export type SteelAgentRunStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
export type SteelAgentRunStepKindDTO =
  | 'MODEL'
  | 'TOOL'
  | 'APPROVAL'
  | 'GUARDRAIL'
export type SteelAgentRunStepStatusDTO =
  | 'OK'
  | 'FAILED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  /** Test run: the write was simulated, never executed. */
  | 'SIMULATED'

export interface SteelAgentToolDTO {
  toolName: string
  /** Effective mode: DELETE tools always come back as APPROVAL. */
  mode: SteelAgentToolModeDTO
}

export interface SteelAgentUserDTO {
  id: string
  name: string
  email: string
  image: string | null
}

export interface SteelAgentRunSummaryDTO {
  id: string
  status: SteelAgentRunStatusDTO
  triggerType: SteelAgentTriggerTypeDTO
  createdAt: string
  finishedAt: string | null
}

export interface SteelAgentDTO {
  id: string
  name: string
  description: string | null
  instructions: string
  triggerType: SteelAgentTriggerTypeDTO
  cron: string | null
  timezone: string
  eventKey: string | null
  enabled: boolean
  owner: SteelAgentUserDTO | null
  createdById: string | null
  maxToolRounds: number
  monthlyRunCap: number | null
  lastRunAt: string | null
  nextRunAt: string | null
  tools: SteelAgentToolDTO[]
  /** Most recent run, if any. */
  lastRun: SteelAgentRunSummaryDTO | null
  createdAt: string
  updatedAt: string
}

/** A registry tool the editor can offer (enabled modules only). */
export interface SteelAgentToolCatalogItemDTO {
  name: string
  label: string
  description: string
  module: AiModuleDTO | null
  kind: 'READ' | AiActionKindDTO
}

export interface SteelAgentEventDTO {
  key: string
  module: AiModuleDTO
  label: string
  description: string
}

/** `GET .../agents/catalog` — tools and events for the editor. */
export interface SteelAgentCatalogDTO {
  tools: SteelAgentToolCatalogItemDTO[]
  events: SteelAgentEventDTO[]
  agentModeEnabled: boolean
  /** Whether the caller can create/edit agents (`steel-agents` EDIT). */
  canManage: boolean
}

export interface SteelAgentRunDTO {
  id: string
  agentId: string
  status: SteelAgentRunStatusDTO
  triggerType: SteelAgentTriggerTypeDTO
  triggerPayload: unknown
  startedById: string | null
  startedAt: string | null
  finishedAt: string | null
  summary: string | null
  error: string | null
  modelKey: string | null
  rounds: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** "Testar agente": reads real, writes simulated, no approvals. */
  isTest: boolean
  /** Run this test re-executed ("Reexecutar como teste"), when it is one. */
  rerunOfId: string | null
  createdAt: string
}

export interface SteelAgentRunStepDTO {
  id: string
  kind: SteelAgentRunStepKindDTO
  toolName: string | null
  /** pt-BR label of the tool, when known. */
  toolLabel: string | null
  pendingActionId: string | null
  input: unknown
  output: unknown
  status: SteelAgentRunStepStatusDTO
  error: string | null
  createdAt: string
}

export interface SteelAgentRunDetailDTO extends SteelAgentRunDTO {
  agent: { id: string; name: string; ownerId: string | null }
  steps: SteelAgentRunStepDTO[]
  pendingActions: AiPendingActionDTO[]
  /** Whether the caller may approve/reject this run's actions. */
  canApprove: boolean
}

export type SteelAgentAssignmentEntityDTO = 'SD_TICKET' | 'CRM_LEAD'

/** Agent a ticket or lead was handed to (`null` = nobody). */
export interface SteelAgentAssignmentDTO {
  entityType: SteelAgentAssignmentEntityDTO
  entityId: string
  agent: { id: string; name: string; enabled: boolean } | null
  assignedAt: string | null
}
