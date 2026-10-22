import { z } from 'zod'

/** Ceilings far above any real price/fee — they only catch typos. */
export const WHATSAPP_PRICE_MAX = 1000
export const WHATSAPP_FEE_MAX = 10_000_000
export const WHATSAPP_COST_MAX_RANGE_DAYS = 400

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')

/** Query of the report and CSV export; both ends are inclusive UTC days. */
export const WhatsAppCostQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    connectionId: z.string().min(1).optional(),
  })
  .refine((value) => value.from <= value.to, {
    message: 'A data inicial deve ser anterior à final',
    path: ['from'],
  })
  .refine(
    (value) =>
      (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <=
      WHATSAPP_COST_MAX_RANGE_DAYS,
    { message: 'O período máximo é de 400 dias', path: ['to'] },
  )

export type WhatsAppCostQueryDTO = z.infer<typeof WhatsAppCostQuerySchema>

export const CreateWhatsAppPriceSchema = z.object({
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use o código do país com 2 letras (ex.: BR)')
    .default('BR'),
  unitPrice: z
    .number()
    .min(0, 'O preço não pode ser negativo')
    .max(WHATSAPP_PRICE_MAX, `Máximo de ${WHATSAPP_PRICE_MAX}`),
  /** Valid from this instant; defaults to now. */
  validFrom: z.iso.datetime().optional(),
})

export type CreateWhatsAppPriceDTO = z.infer<typeof CreateWhatsAppPriceSchema>

const money = (max: number) =>
  z
    .number()
    .min(0, 'O valor não pode ser negativo')
    .max(max, `Máximo de ${max.toLocaleString('pt-BR')}`)
    .nullable()

/** Omitted keeps the value; `null` clears it. */
export const UpdateWhatsAppCostSettingsSchema = z.object({
  monthlyCostBudget: money(WHATSAPP_FEE_MAX).optional(),
  connectionFees: z
    .array(
      z.object({
        connectionId: z.string().min(1),
        monthlyFee: money(WHATSAPP_FEE_MAX),
      }),
    )
    .max(100)
    .optional(),
})

export type UpdateWhatsAppCostSettingsDTO = z.infer<
  typeof UpdateWhatsAppCostSettingsSchema
>
