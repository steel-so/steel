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
})

export type ImportWhatsAppContactsDTO = z.infer<
  typeof ImportWhatsAppContactsSchema
>
