import type { Role } from '@prisma/client'

/**
 * Governance policy of the Steel Agents of a workspace (A6 + A8). Pure
 * functions over the stored row, shared by the services and the runner.
 *
 * - `restrictCreators` off (or no row): who may create agents is decided by
 *   the RBAC matrix alone, as before. On: OWNER/ADMIN plus `creatorRoles`.
 * - `restrictAuto` off (or no row): any tool may be AUTO. On: the role of
 *   whoever sets (and of the owner who runs) the agent decides, per tool.
 *   OWNER is never restricted.
 */

export const AUTO_RULE_MODES = ['ALL', 'NONE', 'LIST'] as const
export type AutoRuleMode = (typeof AUTO_RULE_MODES)[number]

export interface AutoRule {
  mode: AutoRuleMode
  /** Tool names allowed in AUTO when `mode` is LIST. */
  tools: string[]
}

export type AutoRules = Record<Role, AutoRule>

export const POLICY_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const

export const DEFAULT_AUTO_RULES: AutoRules = {
  OWNER: { mode: 'ALL', tools: [] },
  ADMIN: { mode: 'ALL', tools: [] },
  MEMBER: { mode: 'NONE', tools: [] },
  VIEWER: { mode: 'NONE', tools: [] },
}

/** The stored columns the helpers read. */
export interface SteelAgentPolicyLike {
  restrictCreators: boolean
  creatorRoles: Role[]
  restrictAuto: boolean
  autoRules: unknown
}

function parseRule(value: unknown, fallback: AutoRule): AutoRule {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as { mode?: unknown; tools?: unknown }
  const mode = AUTO_RULE_MODES.find((m) => m === raw.mode)
  if (!mode) return fallback
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((t): t is string => typeof t === 'string')
    : []
  return { mode, tools: mode === 'LIST' ? tools : [] }
}

/** Stored JSON → one rule per role (missing/garbled entries use defaults). */
export function parseAutoRules(value: unknown): AutoRules {
  const raw =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    OWNER: DEFAULT_AUTO_RULES.OWNER,
    ADMIN: parseRule(raw.ADMIN, DEFAULT_AUTO_RULES.ADMIN),
    MEMBER: parseRule(raw.MEMBER, DEFAULT_AUTO_RULES.MEMBER),
    VIEWER: parseRule(raw.VIEWER, DEFAULT_AUTO_RULES.VIEWER),
  }
}

/** Whether a role may run `toolName` in AUTO mode under the policy. */
export function canRoleRunAuto(
  policy: SteelAgentPolicyLike | null,
  role: Role,
  toolName: string,
): boolean {
  if (!policy?.restrictAuto || role === 'OWNER') return true
  const rule = parseAutoRules(policy.autoRules)[role]
  if (rule.mode === 'ALL') return true
  if (rule.mode === 'NONE') return false
  return rule.tools.includes(toolName)
}

/**
 * Creators policy: `true` = allowed by the policy (bypasses the RBAC matrix
 * for CREATE), `false` = refused by it, `null` = no restriction configured,
 * defer to RBAC.
 */
export function roleMayCreateAgents(
  policy: SteelAgentPolicyLike | null,
  role: Role,
): boolean | null {
  if (!policy?.restrictCreators) return null
  if (role === 'OWNER' || role === 'ADMIN') return true
  return policy.creatorRoles.includes(role)
}
