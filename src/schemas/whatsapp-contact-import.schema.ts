import { z } from 'zod'
import { CONTACT_IMPORT_MAX_CSV_CHARS } from '@/src/lib/whatsapp/contact-import'

export const ImportWhatsAppContactsSchema = z.object({
  csv: z
    .string()
    .min(1, 'Envie a planilha')
    .max(
      CONTACT_IMPORT_MAX_CSV_CHARS,
      'A planilha é grande demais (máx. 1 MB)',
    ),
  /** Depois de importar, checa se os números têm WhatsApp (só com Z-API). */
  validateWhatsapp: z.boolean().optional(),
})

export type ImportWhatsAppContactsDTO = z.infer<
  typeof ImportWhatsAppContactsSchema
>
