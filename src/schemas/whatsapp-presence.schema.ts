import { z } from 'zod'

export const SetWhatsAppPresenceSchema = z.object({
  status: z.enum(['AVAILABLE', 'AWAY'], {
    error: 'Escolha Disponível ou Ausente',
  }),
})

export type SetWhatsAppPresenceInput = z.infer<typeof SetWhatsAppPresenceSchema>
