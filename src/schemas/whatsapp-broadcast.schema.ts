import { z } from 'zod'
import { validateBroadcastMedia } from '@/src/lib/whatsapp/broadcast-media'

export const CreateWhatsAppBroadcastSchema = z
  .object({
    connectionId: z.string().min(1, 'Conexão é obrigatória'),
    name: z.string().min(1, 'Nome é obrigatório').max(120),
    messageBody: z.string().min(1, 'Mensagem é obrigatória').max(4096),
    mediaUrl: z.url().max(2048).optional(),
    /** Obrigatório com `mediaUrl`: define imagem/vídeo/áudio/documento. */
    mediaMimeType: z.string().min(1).max(200).optional(),
    mediaFileName: z.string().trim().min(1).max(255).optional(),
    mediaSizeBytes: z.number().int().optional(),
    /** Pula (SKIPPED_NO_WHATSAPP) quem a checagem "tem zap?" marcou sem WhatsApp. */
    skipNoWhatsapp: z.boolean().optional(),
    contactIds: z
      .array(z.string().min(1))
      .min(1, 'Selecione ao menos um contato')
      .max(1000, 'Máximo de 1000 contatos por lista'),
  })
  .superRefine((value, ctx) => {
    if (!value.mediaUrl) return
    if (!value.mediaMimeType) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaMimeType'],
        message: 'Informe o tipo do arquivo de mídia',
      })
      return
    }
    const problem = validateBroadcastMedia({
      mimeType: value.mediaMimeType,
      sizeBytes: value.mediaSizeBytes,
    })
    if (problem) {
      ctx.addIssue({ code: 'custom', path: ['mediaUrl'], message: problem })
    }
  })

export type CreateWhatsAppBroadcastDTO = z.infer<
  typeof CreateWhatsAppBroadcastSchema
>
