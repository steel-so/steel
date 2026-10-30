import type { SteelAgentPolicy } from '@prisma/client'
import {
  type AutoRules,
  DEFAULT_AUTO_RULES,
  parseAutoRules,
} from '@/src/lib/steel-agents/policy'
import type {
  SteelAgentPolicyDTO,
  SteelKillSwitchDTO,
} from '@/types/steel-governance'

export function toSteelAgentPolicyDTO(
  policy: SteelAgentPolicy | null,
): SteelAgentPolicyDTO {
  const rules: AutoRules = policy
    ? parseAutoRules(policy.autoRules)
    : DEFAULT_AUTO_RULES
  return {
    restrictCreators: policy?.restrictCreators ?? false,
    creatorRoles: (policy?.creatorRoles ?? []).filter(
      (role) => role !== 'OWNER' && role !== 'ADMIN',
    ),
    restrictAuto: policy?.restrictAuto ?? false,
    autoRules: rules,
  }
}

export function toKillSwitchDTO(
  policy: SteelAgentPolicy | null,
  byName: string | null,
): SteelKillSwitchDTO {
  return {
    active: Boolean(policy?.killedAt),
    at: policy?.killedAt?.toISOString() ?? null,
    byName: policy?.killedAt ? byName : null,
    reason: policy?.killedAt ? (policy.killReason ?? null) : null,
  }
}
