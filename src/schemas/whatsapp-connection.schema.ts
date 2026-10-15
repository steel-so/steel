import { z } from 'zod'

export const WhatsAppProviderSchema = z.enum(['ZAPI', 'META'])

const PhoneNumberField = z
  .string()
  .min(8, 'Número inválido')
  .max(20)
  .regex(/^\d+$/, 'Informe apenas dígitos, com DDI e DDD')

const LabelField = z.string().min(1, 'Nome é obrigatório').max(120)

export const CreateWhatsAppConnectionSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ZAPI'),
    label: LabelField,
    phoneNumber: PhoneNumberField,
    zapiInstanceId: z.string().min(1, 'Instância é obrigatória').max(120),
    zapiToken: z.string().min(1, 'Token é obrigatório').max(255),
    zapiClientToken: z.string().max(255).optional(),
  }),
  z.object({
    provider: z.literal('META'),
    label: LabelField,
    phoneNumber: PhoneNumberField,
    metaPhoneNumberId: z
      .string()
      .min(1, 'Phone Number ID é obrigatório')
      .max(120),
    metaWabaId: z.string().min(1, 'WABA ID é obrigatório').max(120),
    metaAccessToken: z.string().min(1, 'Access token é obrigatório').max(4000),
  }),
])

export type CreateWhatsAppConnectionDTO = z.infer<
  typeof CreateWhatsAppConnectionSchema
>

export const UpdateWhatsAppConnectionSchema = z.object({
  label: LabelField.optional(),
  zapiToken: z.string().min(1).max(255).optional(),
  zapiClientToken: z.string().max(255).optional(),
  metaAccessToken: z.string().min(1).max(4000).optional(),
})

export type UpdateWhatsAppConnectionDTO = z.infer<
  typeof UpdateWhatsAppConnectionSchema
>

/** Result of the Meta Embedded Signup popup, sent by the browser. */
export const MetaEmbeddedSignupSchema = z.object({
  code: z.string().min(1).max(2000),
  phoneNumberId: z.string().regex(/^\d{5,30}$/, 'Phone Number ID inválido'),
  wabaId: z.string().regex(/^\d{5,30}$/, 'WABA ID inválido'),
  label: LabelField.optional(),
})

export type MetaEmbeddedSignupDTO = z.infer<typeof MetaEmbeddedSignupSchema>
