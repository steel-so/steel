import { z } from 'zod'
import { WHATSAPP_CONVERSATION_EXPORT_FORMATS } from '@/src/lib/whatsapp/conversation-export'
import { WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS } from './whatsapp-close-status.schema'

export const StartWhatsAppConversationSchema = z.object({
  contactId: z.string().min(1, 'Contato é obrigatório'),
  connectionId: z.string().min(1, 'Conexão é obrigatória'),
})

export type StartWhatsAppConversationDTO = z.infer<
  typeof StartWhatsAppConversationSchema
>

export const CloseWhatsAppConversationSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Motivo deve ter no máximo 500 caracteres')
    .optional()
    .transform((value) => value || undefined),
  /** Status de fechamento escolhidos (`WhatsAppCloseStatus`); quantos são
   * exigidos depende da configuração do workspace. */
  statusIds: z
    .array(z.string().min(1))
    .max(WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS, 'Escolha no máximo 10 status')
    .optional()
    .default([]),
})

export type CloseWhatsAppConversationDTO = z.input<
  typeof CloseWhatsAppConversationSchema
>

export const ExportWhatsAppConversationSchema = z.object({
  format: z
    .enum(WHATSAPP_CONVERSATION_EXPORT_FORMATS, {
      message: 'Formato deve ser txt ou csv',
    })
    .default('txt'),
})

export type ExportWhatsAppConversationDTO = z.infer<
  typeof ExportWhatsAppConversationSchema
>
