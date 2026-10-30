import z from 'zod'
import { STEEL_AGENT_EVENT_KEYS } from '@/src/lib/steel-agents/events'
import {
  STEEL_AGENT_DEFAULT_TIMEZONE,
  steelAgentTriggerProblem,
} from '@/src/lib/steel-agents/schedule'
import {
  MAX_ROLLOUT_PERCENT,
  MIN_ROLLOUT_PERCENT,
} from '@/src/lib/steel-agents/versions'

export const SteelAgentTriggerTypeSchema = z.enum([
  'SCHEDULE',
  'EVENT',
  'MANUAL',
])
export const SteelAgentToolModeSchema = z.enum(['AUTO', 'APPROVAL'])
export const SteelAgentRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
])

export const STEEL_AGENT_MAX_TOOL_ROUNDS = 20
export const STEEL_AGENT_MAX_TOOLS = 100

export const SteelAgentToolInputSchema = z.object({
  toolName: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, 'Nome de ferramenta inválido'),
  /** Default: requires approval (owner decision of 2026-10-06). */
  mode: SteelAgentToolModeSchema.default('APPROVAL'),
})

const toolsField = z
  .array(SteelAgentToolInputSchema)
  .max(STEEL_AGENT_MAX_TOOLS)
  .refine(
    (tools) => new Set(tools.map((t) => t.toolName)).size === tools.length,
    { message: 'Ferramenta repetida' },
  )

const baseFields = {
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  description: z.string().trim().max(2000).nullable(),
  instructions: z
    .string()
    .trim()
    .min(1, 'Escreva as instruções do agente')
    .max(20_000),
  triggerType: SteelAgentTriggerTypeSchema,
  cron: z.string().trim().max(120).nullable(),
  timezone: z.string().trim().min(1).max(64),
  eventKey: z.enum(STEEL_AGENT_EVENT_KEYS).nullable(),
  enabled: z.boolean(),
  ownerId: z.string().trim().min(1).max(64),
  maxToolRounds: z.number().int().min(1).max(STEEL_AGENT_MAX_TOOL_ROUNDS),
  monthlyRunCap: z.number().int().min(1).max(100_000).nullable(),
  tools: toolsField,
  /** A2: eval set (target STEEL_AGENT) that gates new versions. */
  evalSetId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido')
    .nullable(),
  /** A2: minimum share of passing cases to publish a version (0.1 to 1). */
  evalMinPassRate: z.number().min(0.1).max(1),
}

/** Fields of an edit that describe the version it creates, not the agent. */
const versionFields = {
  changeNote: z.string().trim().max(500).nullable(),
  /** A2: send the new version to this % of the runs instead of replacing. */
  rolloutPercent: z
    .number()
    .int()
    .min(MIN_ROLLOUT_PERCENT)
    .max(MAX_ROLLOUT_PERCENT)
    .nullable(),
}

/** A2+A3: the simulation part of the version gate (set on an existing agent). */
const simGateFields = {
  simGateEnabled: z.boolean(),
  simGateMinPassRate: z.number().min(0.1).max(1),
}

export const CreateSteelAgentSchema = z
  .object({
    ...baseFields,
    description: baseFields.description.optional(),
    cron: baseFields.cron.optional(),
    timezone: baseFields.timezone.default(STEEL_AGENT_DEFAULT_TIMEZONE),
    eventKey: baseFields.eventKey.optional(),
    enabled: baseFields.enabled.default(true),
    maxToolRounds: baseFields.maxToolRounds.default(8),
    monthlyRunCap: baseFields.monthlyRunCap.optional(),
    tools: toolsField.default([]),
    evalSetId: baseFields.evalSetId.optional(),
    evalMinPassRate: baseFields.evalMinPassRate.default(0.8),
  })
  .superRefine((value, ctx) => {
    const problem = steelAgentTriggerProblem(value)
    if (problem) {
      ctx.addIssue({
        code: 'custom',
        path: [value.triggerType === 'EVENT' ? 'eventKey' : 'cron'],
        message: problem,
      })
    }
  })
export type CreateSteelAgentDTO = z.infer<typeof CreateSteelAgentSchema>

/** Partial update; the trigger is re-validated on the merged result. */
export const UpdateSteelAgentSchema = z
  .object({ ...baseFields, ...versionFields, ...simGateFields })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSteelAgentDTO = z.infer<typeof UpdateSteelAgentSchema>

/** Approving an agent write; DELETE requires `doubleConfirmed: true`. */
export const ApproveSteelAgentActionSchema = z.object({
  doubleConfirmed: z.boolean().optional(),
})
export type ApproveSteelAgentActionDTO = z.infer<
  typeof ApproveSteelAgentActionSchema
>

export const ListSteelAgentRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: SteelAgentRunStatusSchema.optional(),
})
export type ListSteelAgentRunsQueryDTO = z.infer<
  typeof ListSteelAgentRunsQuerySchema
>

/** `PUT .../agent` of a ticket or lead: `agentId: null` removes the agent. */
export const AssignSteelAgentSchema = z.object({
  agentId: z.string().trim().min(1).max(64).nullable(),
})
export type AssignSteelAgentDTO = z.infer<typeof AssignSteelAgentSchema>

/** Agents cited with `@` in a comment (ticket message, CRM note). */
export const STEEL_AGENT_MAX_MENTIONS = 5
export const SteelAgentMentionsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(STEEL_AGENT_MAX_MENTIONS, 'Agentes demais citados')
  .optional()

/** Restores an old version as a new one (it goes through the gate again). */
export const RestoreSteelAgentVersionSchema = z.object(versionFields).partial()
export type RestoreSteelAgentVersionDTO = z.infer<
  typeof RestoreSteelAgentVersionSchema
>
