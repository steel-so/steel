import z from 'zod'

/**
 * Contrato da leitura do painel "IA vs. técnico"
 * (`/api/workspaces/[id]/servicedesk/ai/comparison`). Só o recorte do
 * período entra por aqui; tudo o mais é calculado a partir do que a IA
 * sugeriu e do que o técnico fez.
 */

export const SD_AI_COMPARISON_PERIODS = [7, 30, 90] as const

export const SdAiComparisonQuerySchema = z.object({
  /** Janela em dias, contada para trás a partir de agora. */
  days: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce
      .number()
      .int()
      .refine(
        (n): n is (typeof SD_AI_COMPARISON_PERIODS)[number] =>
          (SD_AI_COMPARISON_PERIODS as readonly number[]).includes(n),
        'Período inválido',
      )
      .default(30),
  ),
})
export type SdAiComparisonQueryDTO = z.infer<typeof SdAiComparisonQuerySchema>
