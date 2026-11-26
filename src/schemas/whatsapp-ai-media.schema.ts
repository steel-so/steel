import { z } from 'zod'
import {
  AI_MEDIA_NAME_MAX,
  AI_MEDIA_WHEN_MAX,
} from '@/src/lib/whatsapp/ai-media'

/** Text fields of the upload form (the file travels in the `file` field). */
export const CreateWhatsAppAiMediaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Dê um nome ao arquivo')
    .max(AI_MEDIA_NAME_MAX, `Máximo ${AI_MEDIA_NAME_MAX} caracteres`),
  whenToSend: z
    .string()
    .trim()
    .min(5, 'Explique quando a IA deve enviar o arquivo')
    .max(AI_MEDIA_WHEN_MAX, `Máximo ${AI_MEDIA_WHEN_MAX} caracteres`),
})

export const UpdateWhatsAppAiMediaSchema = z
  .object({
    whenToSend: CreateWhatsAppAiMediaSchema.shape.whenToSend.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.whenToSend !== undefined || v.active !== undefined, {
    message: 'Informe whenToSend ou active',
  })

export type CreateWhatsAppAiMediaDTO = z.infer<
  typeof CreateWhatsAppAiMediaSchema
>
export type UpdateWhatsAppAiMediaDTO = z.infer<
  typeof UpdateWhatsAppAiMediaSchema
>
