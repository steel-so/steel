import { z } from 'zod'

export const WHATSAPP_AD_SPEND_MAX = 10_000_000
export const WHATSAPP_AD_MAX_RANGE_DAYS = 400

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Data inválida',
  })

/** Query of the report and the CSV; both ends are inclusive days (São Paulo). */
export const WhatsAppAdReportQuerySchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((value) => value.from <= value.to, {
    message: 'A data inicial deve ser anterior à final',
    path: ['from'],
  })
  .refine(
    (value) =>
      (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <=
      WHATSAPP_AD_MAX_RANGE_DAYS,
    { message: 'O período máximo é de 400 dias', path: ['to'] },
  )

export type WhatsAppAdReportQueryDTO = z.infer<
  typeof WhatsAppAdReportQuerySchema
>

export const UpdateWhatsAppAdSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  createLeads: z.boolean().optional(),
  /** null clears the owner (the routing rules decide). */
  leadOwnerId: z.string().min(1).nullable().optional(),
  leadSource: z
    .string()
    .trim()
    .min(1, 'Informe a origem do lead')
    .max(60, 'Máximo de 60 caracteres')
    .optional(),
})

export type UpdateWhatsAppAdSettingsDTO = z.infer<
  typeof UpdateWhatsAppAdSettingsSchema
>

export const CreateWhatsAppAdSpendSchema = z
  .object({
    /** Meta ad (or post) id, as shown in the ad report. */
    sourceId: z.string().trim().min(1, 'Informe o anúncio').max(100),
    label: z.string().trim().max(200).optional(),
    periodStart: isoDay,
    periodEnd: isoDay,
    amount: z
      .number()
      .min(0, 'O valor não pode ser negativo')
      .max(WHATSAPP_AD_SPEND_MAX, `Máximo de ${WHATSAPP_AD_SPEND_MAX}`),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.periodStart <= value.periodEnd, {
    message: 'O início deve ser anterior ao fim',
    path: ['periodStart'],
  })

export type CreateWhatsAppAdSpendDTO = z.infer<
  typeof CreateWhatsAppAdSpendSchema
>
