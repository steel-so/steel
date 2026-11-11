import { z } from 'zod'

/** Far above any real monthly spend: only catches typos. */
export const WHATSAPP_SPEND_CAP_MAX = 10_000_000

export const WHATSAPP_SPEND_CAP_MODES = ['WARN', 'BLOCK'] as const

/**
 * Monthly spending cap of one Meta number (ADR 0064). `null` removes the
 * cap; `BLOCK` refuses paid template sends that would cross it.
 */
export const UpdateWhatsAppSpendCapSchema = z.object({
  monthlyCapAmount: z
    .number()
    .positive('O limite precisa ser maior que zero')
    .max(
      WHATSAPP_SPEND_CAP_MAX,
      `Máximo de ${WHATSAPP_SPEND_CAP_MAX.toLocaleString('pt-BR')}`,
    )
    .nullable(),
  capMode: z.enum(WHATSAPP_SPEND_CAP_MODES, {
    error: 'Escolha entre só avisar ou bloquear',
  }),
})

export type UpdateWhatsAppSpendCapDTO = z.infer<
  typeof UpdateWhatsAppSpendCapSchema
>

/** `GET .../costs/spend-caps`: optionally one number only. */
export const WhatsAppSpendCapQuerySchema = z.object({
  connectionId: z.string().min(1).optional(),
})

export type WhatsAppSpendCapQueryDTO = z.infer<
  typeof WhatsAppSpendCapQuerySchema
>
