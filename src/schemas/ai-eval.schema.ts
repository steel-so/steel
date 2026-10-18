import { z } from 'zod'
import { isAiModelKey } from '@/src/lib/ai/models'
import {
  AI_EVAL_MAX_CHECKS,
  AI_EVAL_RUN_REASONS,
  AI_EVAL_TARGETS,
} from '@/src/lib/ai/quality-labels'

const id = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `No máximo ${max.toLocaleString('pt-BR')} caracteres`)
    .nullable()
    .transform((value) => (value ? value : null))

const checks = z
  .array(z.string().trim().min(1, 'Texto vazio').max(200))
  .max(AI_EVAL_MAX_CHECKS, `No máximo ${AI_EVAL_MAX_CHECKS} verificações`)

export const AiEvalTargetSchema = z.enum(AI_EVAL_TARGETS).meta({
  description:
    '`STEEL_ASSISTANT` = o assistente Steel AI (com skill opcional); `WHATSAPP_REPLY` = a resposta automática do WhatsApp (prompt + documentos de conhecimento).',
})

const setFields = {
  name: z.string().trim().min(1, 'Dê um nome ao conjunto').max(120),
  description: optionalText(500),
  skillId: id.nullable(),
}

export const CreateAiEvalSetSchema = z.object({
  name: setFields.name,
  description: setFields.description.default(null),
  target: AiEvalTargetSchema,
  skillId: setFields.skillId.default(null).meta({
    description: 'Só em `STEEL_ASSISTANT`: skill aplicada a todos os casos.',
  }),
})
export type CreateAiEvalSetInput = z.infer<typeof CreateAiEvalSetSchema>

export const UpdateAiEvalSetSchema = z
  .object(setFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para alterar',
  })
export type UpdateAiEvalSetInput = z.infer<typeof UpdateAiEvalSetSchema>

const caseFields = {
  input: z
    .string()
    .trim()
    .min(1, 'Escreva a pergunta')
    .max(4000, 'No máximo 4.000 caracteres'),
  expected: optionalText(4000),
  criteria: optionalText(2000),
  mustContain: checks,
  mustNotContain: checks,
}

type CaseShape = {
  expected?: string | null
  criteria?: string | null
  mustContain?: string[]
  mustNotContain?: string[]
}

function hasGrading(value: CaseShape): boolean {
  return Boolean(
    value.expected ||
      value.criteria ||
      (value.mustContain?.length ?? 0) > 0 ||
      (value.mustNotContain?.length ?? 0) > 0,
  )
}

const GRADING_MESSAGE =
  'Informe a resposta esperada, um critério ou ao menos uma verificação de texto'

export const CreateAiEvalCaseSchema = z
  .object({
    input: caseFields.input,
    expected: caseFields.expected.default(null),
    criteria: caseFields.criteria.default(null),
    mustContain: caseFields.mustContain.default([]),
    mustNotContain: caseFields.mustNotContain.default([]),
  })
  .refine(hasGrading, { message: GRADING_MESSAGE, path: ['expected'] })
export type CreateAiEvalCaseInput = z.infer<typeof CreateAiEvalCaseSchema>

/** Partial update; the service re-checks that the case keeps a grading. */
export const UpdateAiEvalCaseSchema = z
  .object(caseFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para alterar',
  })
export type UpdateAiEvalCaseInput = z.infer<typeof UpdateAiEvalCaseSchema>

export { GRADING_MESSAGE as AI_EVAL_GRADING_MESSAGE, hasGrading }

/**
 * `POST /ai/evals/cases/from-message` — "salvar como caso de teste": the
 * question is the user turn before the assistant message; the expected
 * answer is that message (editable afterwards).
 */
export const AiEvalCaseFromMessageSchema = z.object({
  setId: id,
  messageId: id,
  criteria: caseFields.criteria.default(null),
})
export type AiEvalCaseFromMessageInput = z.infer<
  typeof AiEvalCaseFromMessageSchema
>

/** `POST /ai/evals/{setId}/runs`. */
export const StartAiEvalRunSchema = z.object({
  modelKey: z
    .string()
    .refine(isAiModelKey, 'Modelo fora do catálogo')
    .nullable()
    .default(null)
    .meta({
      description:
        'Modelo a avaliar (`<provedor>:<modelo>`); nulo = o padrão atual. Precisa estar habilitado no workspace.',
    }),
  skillId: id.nullable().default(null).meta({
    description:
      'Skill a usar nesta execução no lugar da do conjunto (rascunho antes de salvar).',
  }),
  promptOverride: optionalText(8000).default(null).meta({
    description:
      'Só em `WHATSAPP_REPLY`: prompt em rascunho testado antes de salvar.',
  }),
  reason: z.enum(AI_EVAL_RUN_REASONS).default('manual'),
})
export type StartAiEvalRunInput = z.infer<typeof StartAiEvalRunSchema>

/** `GET /ai/evals/latest` — last finished run of each set of a target. */
export const AiEvalLatestQuerySchema = z.object({
  target: AiEvalTargetSchema,
})
export type AiEvalLatestQuery = z.infer<typeof AiEvalLatestQuerySchema>

/** Structured output of the LLM judge. */
export const AiEvalJudgeOutputSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().max(2000),
})
export type AiEvalJudgeOutput = z.infer<typeof AiEvalJudgeOutputSchema>

export const AI_EVAL_JUDGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'rationale'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
} as const
