import type { SteelAgentToolModeDTO, SteelAgentTriggerTypeDTO } from './steel-agent'
import type { AiModuleDTO } from './steel-ai'

/**
 * Governance panel of the Steel Agents (`/api/workspaces/:id/agents/governance`,
 * A6) and the workspace policy (A8): inventory, approval metrics, cost vs
 * impact, the emergency switch and who may create / run in AUTO.
 */

export type SteelGovernanceRoleDTO = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
export type SteelAutoRuleModeDTO = 'ALL' | 'NONE' | 'LIST'

export interface SteelAutoRuleDTO {
  mode: SteelAutoRuleModeDTO
  /** Tool names allowed in AUTO when `mode` is LIST. */
  tools: string[]
}

export interface SteelAgentPolicyDTO {
  restrictCreators: boolean
  /** Roles besides OWNER/ADMIN that may create agents (when restricted). */
  creatorRoles: SteelGovernanceRoleDTO[]
  restrictAuto: boolean
  autoRules: Record<SteelGovernanceRoleDTO, SteelAutoRuleDTO>
}

export interface SteelKillSwitchDTO {
  active: boolean
  at: string | null
  byName: string | null
  reason: string | null
}

export type SteelAgentRiskFlagDTO =
  /** The owner left the workspace: the agent never runs. */
  | 'NO_OWNER'
  /** At least one write tool runs on its own. */
  | 'AUTO_WRITES'
  /** Can message customers or call external servers. */
  | 'CONTACTS_THIRD_PARTIES'
  /** Delegates to other agents. */
  | 'DELEGATES'

export interface SteelGovernanceToolDTO {
  toolName: string
  label: string
  kind: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION' | 'UNKNOWN'
  module: AiModuleDTO | null
  mode: SteelAgentToolModeDTO
  external: boolean
}

export interface SteelGovernanceMetricsDTO {
  runs: number
  succeeded: number
  failed: number
  skipped: number
  /** Own cost, delegated runs not included. */
  costUsd: number
  delegatedCostUsd: number
  /** Writes that went through (automatic or approved). */
  applied: number
  approvals: {
    approved: number
    rejected: number
    expired: number
    pending: number
  }
  /** approved / decided (0..1); null while nothing was decided. */
  approvalRate: number | null
  rejectionRate: number | null
  /** USD per applied write; null while nothing was applied. */
  costPerApplied: number | null
  lastRunAt: string | null
}

export interface SteelGovernanceAgentDTO {
  id: string
  name: string
  description: string | null
  enabled: boolean
  triggerType: SteelAgentTriggerTypeDTO
  owner: {
    id: string
    name: string
    email: string
    /** null = no longer a member. */
    role: SteelGovernanceRoleDTO | null
  } | null
  createdByName: string | null
  tools: SteelGovernanceToolDTO[]
  delegates: { id: string; name: string }[]
  /** Modules the tools reach (personal data lives there). */
  modules: AiModuleDTO[]
  risks: SteelAgentRiskFlagDTO[]
  metrics: SteelGovernanceMetricsDTO
}

export interface SteelGovernanceDTO {
  periodDays: number
  since: string
  killSwitch: SteelKillSwitchDTO
  policy: SteelAgentPolicyDTO
  totals: {
    agents: number
    active: number
    withoutOwner: number
    runs: number
    costUsd: number
    applied: number
    approvalRate: number | null
  }
  agents: SteelGovernanceAgentDTO[]
}

/** `POST .../governance/kill` */
export interface SteelKillResultDTO {
  killSwitch: SteelKillSwitchDTO
  canceledRuns: number
  canceledActions: number
}
