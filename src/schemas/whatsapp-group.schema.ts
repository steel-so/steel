import { z } from 'zod'
import { WaIdField } from '@/src/schemas/phone.schema'

export const CreateWhatsAppGroupSchema = z.object({
  connectionId: z.string().min(1, 'Conexão é obrigatória'),
  name: z.string().min(1).max(120),
  participantWaIds: z.array(WaIdField).min(1, 'Adicione ao menos um contato'),
})

export type CreateWhatsAppGroupDTO = z.infer<typeof CreateWhatsAppGroupSchema>

export const UpdateWhatsAppGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(512).optional(),
  imageUrl: z.url().max(2048).optional(),
})

export type UpdateWhatsAppGroupDTO = z.infer<typeof UpdateWhatsAppGroupSchema>

export const GroupParticipantsSchema = z.object({
  waIds: z.array(WaIdField).min(1),
})

export type GroupParticipantsDTO = z.infer<typeof GroupParticipantsSchema>

export const SetGroupAdminSchema = z.object({
  waId: WaIdField,
  admin: z.boolean(),
})

export type SetGroupAdminDTO = z.infer<typeof SetGroupAdminSchema>

export const SendWhatsAppGroupTextMessageSchema = z.object({
  text: z.string().min(1, 'Mensagem não pode ser vazia').max(4096),
  mentionedWaIds: z.array(WaIdField).optional(),
})

export type SendWhatsAppGroupTextMessageDTO = z.infer<
  typeof SendWhatsAppGroupTextMessageSchema
>
