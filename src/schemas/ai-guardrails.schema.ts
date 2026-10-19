import { z } from 'zod'

export const AI_PII_MASKING_POLICIES = [
  'OFF',
  'AUTO_REPLIES',
  'EVERYWHERE',
] as const

export const AI_FORBIDDEN_TOPICS_MAX = 50
export const AI_FORBIDDEN_TOPIC_MAX_CHARS = 80
export const AI_MAX_REFUND_AMOUNT = 1_000_000
export const AI_MAX_DEADLINE_DAYS = 3650

/**
 * Steel AI guardrails of the workspace (OWNER/ADMIN, ADR 0041). PATCH:
 * every field optional; `null` clears an authority limit.
 */
export const UpdateWorkspaceAiGuardrailsSchema = z.object({
  piiMaskingPolicy: z
    .enum(AI_PII_MASKING_POLICIES, {
      error: 'Política de mascaramento inválida',
    })
    .optional(),
  injectionClassifierEnabled: z.boolean().optional(),
  forbiddenTopics: z
    .array(
      z
        .string()
        .trim()
        .min(2, 'Cada assunto precisa de ao menos 2 caracteres')
        .max(
          AI_FORBIDDEN_TOPIC_MAX_CHARS,
          `Cada assunto pode ter até ${AI_FORBIDDEN_TOPIC_MAX_CHARS} caracteres`,
        ),
    )
    .max(
      AI_FORBIDDEN_TOPICS_MAX,
      `Cadastre no máximo ${AI_FORBIDDEN_TOPICS_MAX} assuntos`,
    )
    .refine(
      (topics) =>
        new Set(topics.map((t) => t.toLowerCase())).size === topics.length,
      { message: 'Assuntos repetidos' },
    )
    .optional(),
  maxDiscountPercent: z
    .number()
    .int('Informe um percentual inteiro')
    .min(0, 'O percentual não pode ser negativo')
    .max(100, 'O percentual vai até 100')
    .nullable()
    .optional(),
  maxRefundAmount: z
    .number()
    .min(0, 'O valor não pode ser negativo')
    .max(AI_MAX_REFUND_AMOUNT, 'Valor acima do limite permitido')
    .multipleOf(0.01, 'Use no máximo duas casas decimais')
    .nullable()
    .optional(),
  maxDeadlineDays: z
    .number()
    .int('Informe um número inteiro de dias')
    .min(0, 'O prazo não pode ser negativo')
    .max(AI_MAX_DEADLINE_DAYS, `Máximo de ${AI_MAX_DEADLINE_DAYS} dias`)
    .nullable()
    .optional(),
})

export type UpdateWorkspaceAiGuardrailsDTO = z.infer<
  typeof UpdateWorkspaceAiGuardrailsSchema
>
