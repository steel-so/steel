import { z } from 'zod'

/** Ceiling for a monthly limit — far above any real Communication volume. */
export const WHATSAPP_USAGE_LIMIT_MAX = 10_000_000

/** Usage percentages that notify every workspace member, once per month. */
export const WHATSAPP_USAGE_THRESHOLDS = [50, 80, 100] as const

export type WhatsAppUsageThreshold = (typeof WHATSAPP_USAGE_THRESHOLDS)[number]

export type WhatsAppUsageMetric = 'conversations' | 'messages'

const monthlyLimit = z
  .number()
  .int('Informe um número inteiro')
  .min(1, 'O limite mínimo é 1 — deixe em branco para ilimitado')
  .max(
    WHATSAPP_USAGE_LIMIT_MAX,
    `Máximo de ${WHATSAPP_USAGE_LIMIT_MAX.toLocaleString('pt-BR')}`,
  )
  .nullable()
  .optional()

/** `null` = unlimited; an omitted field keeps the current value. */
export const UpdateWhatsAppUsageLimitsSchema = z.object({
  monthlyConversationLimit: monthlyLimit,
  monthlyMessageLimit: monthlyLimit,
})

export type UpdateWhatsAppUsageLimitsDTO = z.infer<
  typeof UpdateWhatsAppUsageLimitsSchema
>
