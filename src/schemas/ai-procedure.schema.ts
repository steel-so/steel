import z from 'zod'
import {
  CHATBOT_CONDITION_OPERATORS,
  CHATBOT_QUESTION_VALIDATIONS,
} from '@/src/schemas/whatsapp-chatbot.schema'

/** Limits shared by the schema, the editor and the engine (A5). */
export const PROCEDURE_LIMITS = {
  procedures: 50,
  steps: 30,
  name: 80,
  title: 80,
  text: 1000,
  instruction: 500,
  attempts: { min: 1, max: 5 },
  saves: 5,
  args: 10,
} as const

/** Variables the runtime fills before the first step. */
export const PROCEDURE_PRESET_VARIABLES = [
  'contact_name',
  'contact_phone',
] as const

const IDENTIFIER = /^[a-z][a-z0-9_]{0,39}$/

export const ProcedureKeySchema = z
  .string()
  .regex(IDENTIFIER, 'Use letras minúsculas, números e _ (começando por letra)')
export const ProcedureVariableSchema = ProcedureKeySchema

export const ProcedureStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])

export const ProcedureConditionSchema = z.object({
  variable: ProcedureVariableSchema,
  operator: z.enum(CHATBOT_CONDITION_OPERATORS),
  value: z.string().max(200).default(''),
})

const SaveSchema = z.object({
  variable: ProcedureVariableSchema,
  /** Dotted path into the JSON answer (`a.b.0.c`). */
  path: z.string().trim().min(1).max(200),
})

const baseStep = {
  key: ProcedureKeySchema,
  title: z.string().trim().min(1).max(PROCEDURE_LIMITS.title),
  /** A required step can never be skipped; a failure hands off to a human. */
  required: z.boolean().default(true),
  /** The step applies only when this holds (otherwise it is skipped). */
  condition: ProcedureConditionSchema.nullable().optional(),
}

export const ProcedureStepSchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseStep,
    kind: z.literal('COLLECT'),
    variable: ProcedureVariableSchema,
    prompt: z.string().trim().min(1).max(PROCEDURE_LIMITS.instruction),
    validation: z.enum(CHATBOT_QUESTION_VALIDATIONS).default('TEXT'),
  }),
  z.object({
    ...baseStep,
    kind: z.literal('HTTP'),
    method: z.enum(['GET', 'POST']).default('GET'),
    url: z.string().trim().min(1).max(500),
    body: z.string().max(2000).optional(),
    saves: z.array(SaveSchema).max(PROCEDURE_LIMITS.saves).default([]),
  }),
  z.object({
    ...baseStep,
    kind: z.literal('TOOL'),
    toolName: z.string().trim().min(1).max(64),
    args: z
      .record(z.string().max(60), z.string().max(300))
      .refine((a) => Object.keys(a).length <= PROCEDURE_LIMITS.args)
      .default({}),
    saves: z.array(SaveSchema).max(PROCEDURE_LIMITS.saves).default([]),
  }),
  z.object({
    ...baseStep,
    kind: z.literal('MESSAGE'),
    /** Fixed text sent as written (variables replaced). */
    text: z.string().trim().max(PROCEDURE_LIMITS.text).optional(),
    /** Or: what the model must say, in its own words. */
    instruction: z
      .string()
      .trim()
      .max(PROCEDURE_LIMITS.instruction)
      .optional(),
  }),
  z.object({
    ...baseStep,
    kind: z.literal('HANDOFF'),
    text: z.string().trim().max(PROCEDURE_LIMITS.text).optional(),
  }),
])
export type ProcedureStep = z.infer<typeof ProcedureStepSchema>
export type ProcedureCondition = z.infer<typeof ProcedureConditionSchema>

const definition = {
  name: z.string().trim().min(1).max(PROCEDURE_LIMITS.name),
  description: z.string().trim().max(500).nullable().optional(),
  whenToUse: z.string().trim().min(1).max(PROCEDURE_LIMITS.instruction),
  steps: z.array(ProcedureStepSchema).min(1).max(PROCEDURE_LIMITS.steps),
  maxAttempts: z
    .number()
    .int()
    .min(PROCEDURE_LIMITS.attempts.min)
    .max(PROCEDURE_LIMITS.attempts.max)
    .default(3),
  handoffMessage: z.string().trim().max(PROCEDURE_LIMITS.text).nullable().optional(),
  whatsappEnabled: z.boolean().default(true),
  agentIds: z.array(z.string()).max(50).default([]),
  ownerId: z.string().nullable().optional(),
}

export const CreateAiProcedureSchema = z.object({
  ...definition,
  status: ProcedureStatusSchema.default('DRAFT'),
})
export type CreateAiProcedureDTO = z.infer<typeof CreateAiProcedureSchema>

export const UpdateAiProcedureSchema = z
  .object({
    name: definition.name,
    description: definition.description,
    whenToUse: definition.whenToUse,
    steps: definition.steps,
    maxAttempts: z
      .number()
      .int()
      .min(PROCEDURE_LIMITS.attempts.min)
      .max(PROCEDURE_LIMITS.attempts.max),
    handoffMessage: definition.handoffMessage,
    whatsappEnabled: z.boolean(),
    agentIds: definition.agentIds,
    ownerId: definition.ownerId,
    status: ProcedureStatusSchema,
    /** Goes into the history when the edit creates a version. */
    changeNote: z.string().trim().max(300).nullable().optional(),
  })
  .partial()
export type UpdateAiProcedureDTO = z.infer<typeof UpdateAiProcedureSchema>

export const PreviewAiProcedureSchema = z.object({
  /** Variables assumed known (e.g. `{ "plano": "premium" }`). */
  variables: z.record(z.string().max(60), z.string().max(300)).default({}),
})
export type PreviewAiProcedureDTO = z.infer<typeof PreviewAiProcedureSchema>

export const ListAiProcedureRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z
    .enum(['RUNNING', 'COMPLETED', 'FAILED', 'HANDED_OFF', 'CANCELED'])
    .optional(),
})
export type ListAiProcedureRunsQueryDTO = z.infer<
  typeof ListAiProcedureRunsQuerySchema
>

export const RestoreAiProcedureVersionSchema = z.object({
  changeNote: z.string().trim().max(300).nullable().optional(),
})
