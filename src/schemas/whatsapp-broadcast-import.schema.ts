import { z } from 'zod'

export const CreateWhatsAppBroadcastImportSchema = z.object({
  name: z.string().min(1).max(140),
  connectionId: z.string().min(1),
  templateId: z.string().min(1),
  sendOffsetHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),
  csv: z.string().min(1),
  /** Depois de importar, checa se os números têm WhatsApp (só com Z-API). */
  validateWhatsapp: z.boolean().optional(),
  /** Pula (SKIPPED_NO_WHATSAPP) quem a checagem marcou sem WhatsApp. */
  skipNoWhatsapp: z.boolean().optional(),
})

export type CreateWhatsAppBroadcastImportDTO = z.infer<
  typeof CreateWhatsAppBroadcastImportSchema
>
