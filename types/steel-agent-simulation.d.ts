/**
 * Public contract of the agent persona simulations
 * (`/api/workspaces/:id/agents/:agentId/simulations/**`). A simulation runs
 * whole conversations between an AI-played customer persona and the agent
 * (reads real, writes simulated); an AI judge scores each transcript.
 */

export type SteelAgentSimulationStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
export type SteelAgentSimulationCaseStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
export type SteelAgentSimulationVerdictDTO = 'PASS' | 'FAIL'
export type SteelAgentSimulationChannelDTO =
  | 'WHATSAPP'
  | 'EMAIL'
  | 'PORTAL'
  | 'CHAT'

export interface SteelAgentSimulationTurnDTO {
  role: 'customer' | 'agent'
  text: string
}

export interface SteelAgentSimulationToolEventDTO {
  /** 1-based customer turn the tool call belongs to. */
  turn: number
  toolName: string
  kind: string
  status: 'OK' | 'SIMULATED' | 'FAILED'
  /** Preview title (writes) or read summary. */
  title: string | null
  error: string | null
}

export interface SteelAgentSimulationCriterionResultDTO {
  criterion: string
  met: boolean
  evidence: string
}

export interface SteelAgentSimulationCaseDTO {
  id: string
  position: number
  label: string
  personaKey: string | null
  persona: string
  scenario: string
  channel: SteelAgentSimulationChannelDTO
  openingMessage: string
  criteria: string[]
  maxTurns: number
  status: SteelAgentSimulationCaseStatusDTO
  verdict: SteelAgentSimulationVerdictDTO | null
  score: number | null
  transcript: SteelAgentSimulationTurnDTO[]
  toolEvents: SteelAgentSimulationToolEventDTO[]
  criteriaResults: SteelAgentSimulationCriterionResultDTO[]
  judgeSummary: string | null
  endReason: string | null
  error: string | null
  costUsd: number
  startedAt: string | null
  finishedAt: string | null
}

export interface SteelAgentSimulationDTO {
  id: string
  agentId: string
  name: string
  status: SteelAgentSimulationStatusDTO
  startedById: string | null
  passScore: number
  totalCases: number
  passedCases: number
  failedCases: number
  avgScore: number | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  modelKey: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface SteelAgentSimulationDetailDTO extends SteelAgentSimulationDTO {
  agentName: string
  cases: SteelAgentSimulationCaseDTO[]
}

/** A scenario proposed by the AI, not saved yet (the admin edits it). */
export interface SteelAgentSimulationScenarioDraftDTO {
  label: string
  persona: string
  scenario: string
  channel: SteelAgentSimulationChannelDTO
  openingMessage: string
  criteria: string[]
}
