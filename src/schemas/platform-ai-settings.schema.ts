import { z } from 'zod'
import { MAX_AI_COST_MARGIN, MIN_AI_COST_MARGIN } from '@/src/lib/ai/models'

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
  reason: z.string().trim().max(500).optional(),
})

export type UpdatePlatformAiSettingsDTO = z.infer<
  typeof UpdatePlatformAiSettingsSchema
>
