import { z } from 'zod'

export const SendWhatsAppTextMessageSchema = z.object({
  text: z.string().min(1, 'Mensagem não pode ser vazia').max(4096),
  replyToMessageId: z.string().optional(),
})

export type SendWhatsAppTextMessageDTO = z.infer<
  typeof SendWhatsAppTextMessageSchema
>

export const SendWhatsAppMediaMessageSchema = z.object({
  mediaUrl: z.url(),
  type: z.enum(['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT']),
  caption: z.string().max(1024).optional(),
  fileName: z.string().max(255).optional(),
  replyToMessageId: z.string().optional(),
})

export type SendWhatsAppMediaMessageDTO = z.infer<
  typeof SendWhatsAppMediaMessageSchema
>

export const SendWhatsAppTemplateMessageSchema = z.object({
  templateName: z.string().min(1),
  language: z.string().min(1).max(20),
  components: z.array(z.unknown()).optional(),
})

export type SendWhatsAppTemplateMessageDTO = z.infer<
  typeof SendWhatsAppTemplateMessageSchema
>

export const SendWhatsAppContactMessageSchema = z.object({
  contactId: z.string().min(1, 'Contato é obrigatório'),
})

export type SendWhatsAppContactMessageDTO = z.infer<
  typeof SendWhatsAppContactMessageSchema
>

export const ReactToWhatsAppMessageSchema = z.object({
  // Empty string removes the reaction.
  emoji: z.string().max(8),
})

export type ReactToWhatsAppMessageDTO = z.infer<
  typeof ReactToWhatsAppMessageSchema
>

export const ListWhatsAppMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export type ListWhatsAppMessagesDTO = z.infer<typeof ListWhatsAppMessagesSchema>

// POST .../messages/quick-reply — sends a saved quick reply (body, media and
// buttons) through the provider. `variables` overrides `{token}` values
// (e.g. `{ nome_cliente: 'Ana' }`); the rest are resolved on the server.
export const SendWhatsAppQuickReplyMessageSchema = z.object({
  quickReplyId: z.string().min(1, 'Mensagem pronta é obrigatória'),
  variables: z
    .record(z.string().regex(/^\w{1,50}$/), z.string().max(1000))
    .optional(),
})

export type SendWhatsAppQuickReplyMessageDTO = z.infer<
  typeof SendWhatsAppQuickReplyMessageSchema
>
