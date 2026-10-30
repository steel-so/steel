import z from 'zod'
import {
  GOVERNANCE_DEFAULT_DAYS,
  GOVERNANCE_MAX_DAYS,
} from '@/src/lib/steel-agents/governance'

const RoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'])

export const SteelGovernanceQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(GOVERNANCE_MAX_DAYS)
    .default(GOVERNANCE_DEFAULT_DAYS),
})
export type SteelGovernanceQueryDTO = z.infer<typeof SteelGovernanceQuerySchema>

export const KillSteelAgentsSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
})
export type KillSteelAgentsDTO = z.infer<typeof KillSteelAgentsSchema>

const AutoRuleSchema = z.object({
  mode: z.enum(['ALL', 'NONE', 'LIST']),
  tools: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{1,63}$/),
    )
    .max(300)
    .default([]),
})

export const UpdateSteelAgentPolicySchema = z.object({
  restrictCreators: z.boolean(),
  /** Roles besides OWNER/ADMIN (those two always may). */
  creatorRoles: z.array(RoleSchema).max(4),
  restrictAuto: z.boolean(),
  autoRules: z.object({
    ADMIN: AutoRuleSchema,
    MEMBER: AutoRuleSchema,
    VIEWER: AutoRuleSchema,
  }),
})
export type UpdateSteelAgentPolicyDTO = z.infer<
  typeof UpdateSteelAgentPolicySchema
>
