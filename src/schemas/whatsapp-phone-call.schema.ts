import { z } from 'zod'

export const StartWhatsAppPhoneCallSchema = z.object({
  // DIRECT: the PABX rings the contact right away; RECORDING: plays the
  // greeting audio first.
  mode: z.enum(['DIRECT', 'RECORDING']).default('DIRECT'),
})

export type StartWhatsAppPhoneCallDTO = z.infer<
  typeof StartWhatsAppPhoneCallSchema
>

export interface WhatsAppPhoneCallDTO {
  conversationId: string
  extension: string
  destination: string
  mode: StartWhatsAppPhoneCallDTO['mode']
}
