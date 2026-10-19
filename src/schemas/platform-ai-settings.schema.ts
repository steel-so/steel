import { z } from 'zod'
import {
  AI_MODEL_KEYS,
  MAX_AI_COST_MARGIN,
  MIN_AI_COST_MARGIN,
} from '@/src/lib/ai/models'

const TaskModelSchema = z
  .enum(AI_MODEL_KEYS, { error: 'Modelo de IA desconhecido' })
  .nullable()
  .optional()

/**
 * Global admin: platform margin over the provider price of every AI call
 * (1 = at cost, 1.3 = +30%). Applies to calls made after the change; past
 * usage keeps its frozen cost.
 */
export const UpdatePlatformAiSettingsSchema = z.object({
  costMargin: z.coerce
    .number()
    .min(MIN_AI_COST_MARGIN)
    .max(MAX_AI_COST_MARGIN)
    .meta({
      description: 'Multiplicador sobre o preço do provedor (1 = custo).',
    }),
  /**
   * Semantic half of the Steel AI knowledge search (ADR 0037). Optional:
   * absent keeps the saved value.
   */
  embeddingsEnabled: z.boolean().optional().meta({
    description:
      'Embeddings da busca de conhecimento (OpenAI). Desligado = busca só por texto.',
  }),
  /**
   * Default model of each task class (ADR 0042) for workspaces that did not
   * choose one; `null` = the platform default model. Absent keeps it.
   */
  taskModels: z
    .object({
      CLASSIFICATION: TaskModelSchema,
      CONVERSATION: TaskModelSchema,
      ASSISTANT: TaskModelSchema,
      AGENT: TaskModelSchema,
    })
    .optional(),
  /** Platform-wide switch of the provider failover (ADR 0042). */
  failoverEnabled: z.boolean().optional().meta({
    description:
      'Contingência automática de provedor. Desligado = nenhuma chamada troca de modelo.',
  }),
  reason: z.string().trim().max(500).optional(),
})

export type UpdatePlatformAiSettingsDTO = z.infer<
  typeof UpdatePlatformAiSettingsSchema
>
