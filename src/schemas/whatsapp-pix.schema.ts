import { z } from 'zod'

/** Pix limits: R$ 0,01 up to R$ 999.999,99 per charge. */
export const PIX_MIN_AMOUNT = 0.01
export const PIX_MAX_AMOUNT = 999_999.99
/** The PSP "info" field holds at most 140 characters. */
export const PIX_DESCRIPTION_MAX = 140
/** From 5 minutes to 7 days. */
export const PIX_MIN_EXPIRES_MINUTES = 5
export const PIX_MAX_EXPIRES_MINUTES = 10_080

/** Amount in reais, rounded to the cent. */
const amount = z
  .number('Informe o valor da cobrança')
  .min(PIX_MIN_AMOUNT, 'O valor mínimo é R$ 0,01')
  .max(PIX_MAX_AMOUNT, 'O valor máximo é R$ 999.999,99')
  .transform((value) => Math.round(value * 100) / 100)

const description = z
  .string()
  .trim()
  .min(1, 'Descreva o que está sendo cobrado')
  .max(
    PIX_DESCRIPTION_MAX,
    `A descrição pode ter até ${PIX_DESCRIPTION_MAX} caracteres`,
  )

const expiresInMinutes = z
  .number()
  .int('Informe um número inteiro de minutos')
  .min(PIX_MIN_EXPIRES_MINUTES, `O mínimo é de ${PIX_MIN_EXPIRES_MINUTES} min`)
  .max(PIX_MAX_EXPIRES_MINUTES, 'O máximo é de 7 dias')

// POST .../conversations/{conversationId}/pix
export const CreateWhatsAppPixChargeSchema = z.object({
  amount,
  description,
  /** Omitted = the workspace default (`defaultExpiresMinutes`). */
  expiresInMinutes: expiresInMinutes.optional(),
  /** CRM deal that gets a note when the charge is paid. */
  opportunityId: z.string().min(1).optional(),
})

export type CreateWhatsAppPixChargeDTO = z.infer<
  typeof CreateWhatsAppPixChargeSchema
>

// PATCH .../whatsapp/pix/settings
export const UpdateWhatsAppPixSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultExpiresMinutes: expiresInMinutes.optional(),
})

export type UpdateWhatsAppPixSettingsDTO = z.infer<
  typeof UpdateWhatsAppPixSettingsSchema
>

/**
 * Body the `mock` provider posts to its payment webhook (signed with
 * HMAC-SHA256 in the `x-pix-signature` header). A real PSP gets its own
 * parser behind `PixProvider.parseWebhook`.
 */
export const MockPixWebhookSchema = z.object({
  providerChargeId: z.string().min(1).max(64),
  paidAmount: z.number().min(0).max(PIX_MAX_AMOUNT),
  paidAt: z.iso.datetime().optional(),
  endToEndId: z.string().max(64).optional(),
  payerName: z.string().max(120).optional(),
})

export type MockPixWebhookDTO = z.infer<typeof MockPixWebhookSchema>
