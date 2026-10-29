import { z } from 'zod'
import { WHATSAPP_COPILOT_TONES } from '@/src/lib/whatsapp/copilot'

export const WHATSAPP_COPILOT_DRAFT_MAX = 4096

/** "Sugerir resposta": an optional hint from the agent ("ofereça 10% de desconto"). */
export const SuggestWhatsAppCopilotReplySchema = z.object({
  hint: z
    .string()
    .trim()
    .max(500, 'A orientação deve ter no máximo 500 caracteres')
    .optional()
    .transform((value) => value || undefined),
})

export type SuggestWhatsAppCopilotReplyDTO = z.input<
  typeof SuggestWhatsAppCopilotReplySchema
>

/** "Ajustar tom": the draft the agent typed and the tone to rewrite it in. */
export const AdjustWhatsAppCopilotToneSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem antes de ajustar o tom')
    .max(
      WHATSAPP_COPILOT_DRAFT_MAX,
      `A mensagem deve ter no máximo ${WHATSAPP_COPILOT_DRAFT_MAX} caracteres`,
    ),
  tone: z.enum(WHATSAPP_COPILOT_TONES),
})

export type AdjustWhatsAppCopilotToneDTO = z.infer<
  typeof AdjustWhatsAppCopilotToneSchema
>
