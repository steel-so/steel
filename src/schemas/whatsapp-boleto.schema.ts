import { z } from 'zod'

/** AbacatePay minimum; the same ceiling as the Pix charge. */
export const BOLETO_MIN_AMOUNT = 1
export const BOLETO_MAX_AMOUNT = 999_999.99
export const BOLETO_DESCRIPTION_MAX = 140

/** CPF (11) or CNPJ (14) as digits; punctuation is accepted and stripped. */
export const BoletoTaxIdSchema = z
  .string('Informe o CPF ou CNPJ do pagador')
  .transform((value) => value.replace(/\D/g, ''))
  .refine(
    (digits) => digits.length === 11 || digits.length === 14,
    'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido',
  )

// POST .../conversations/{conversationId}/boleto
export const CreateWhatsAppBoletoChargeSchema = z.object({
  amount: z
    .number('Informe o valor da cobrança')
    .min(BOLETO_MIN_AMOUNT, 'O valor mínimo do boleto é R$ 1,00')
    .max(BOLETO_MAX_AMOUNT, 'O valor máximo é R$ 999.999,99')
    .transform((value) => Math.round(value * 100) / 100),
  description: z
    .string()
    .trim()
    .min(1, 'Descreva o que está sendo cobrado')
    .max(
      BOLETO_DESCRIPTION_MAX,
      `A descrição pode ter até ${BOLETO_DESCRIPTION_MAX} caracteres`,
    ),
  payerName: z
    .string('Informe o nome do pagador')
    .trim()
    .min(2, 'Informe o nome do pagador')
    .max(120),
  payerTaxId: BoletoTaxIdSchema,
  /** Days until the due date (1 to 90). */
  dueInDays: z.number().int().min(1).max(90).default(3),
  opportunityId: z.string().min(1).optional(),
})

export type CreateWhatsAppBoletoChargeDTO = z.infer<
  typeof CreateWhatsAppBoletoChargeSchema
>

// PATCH .../whatsapp/boleto/settings
export const UpdateWhatsAppBoletoSettingsSchema = z.object({
  enabled: z.boolean().optional(),
})

export type UpdateWhatsAppBoletoSettingsDTO = z.infer<
  typeof UpdateWhatsAppBoletoSettingsSchema
>
