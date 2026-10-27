import { z } from 'zod'
import { clearableText, clearableUrl } from '@/src/schemas/clearable.schema'

const WaIdField = z
  .string()
  .min(8, 'Número inválido')
  .max(20)
  .regex(/^\d+$/, 'Informe apenas dígitos, com DDI e DDD')

export const CreateWhatsAppContactSchema = z.object({
  waId: WaIdField,
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z.url().max(2048).optional(),
  description: z.string().max(500).optional(),
})

export type CreateWhatsAppContactDTO = z.infer<
  typeof CreateWhatsAppContactSchema
>

// Campos limpáveis: null (ou '') apaga o valor; omitido = sem alteração.
export const UpdateWhatsAppContactSchema = z.object({
  name: clearableText(120),
  avatarUrl: clearableUrl(2048),
  description: clearableText(500),
})

export type UpdateWhatsAppContactDTO = z.infer<
  typeof UpdateWhatsAppContactSchema
>

/**
 * Opt-out LGPD de transmissões, operado por admin no cadastro do contato.
 * Reinscrever (`optedOut: false`) só é permitido mediante pedido explícito do
 * próprio contato — o admin precisa confirmar isso (`contactRequested`), e o
 * evento vai para a auditoria.
 */
export const UpdateWhatsAppContactBroadcastOptOutSchema = z
  .object({
    optedOut: z.boolean(),
    contactRequested: z.boolean().optional(),
  })
  .refine((data) => data.optedOut || data.contactRequested === true, {
    message:
      'Reinscrição só é permitida a pedido explícito do contato — confirme o pedido',
    path: ['contactRequested'],
  })

export type UpdateWhatsAppContactBroadcastOptOutDTO = z.infer<
  typeof UpdateWhatsAppContactBroadcastOptOutSchema
>

export const FindOrCreateWhatsAppContactSchema = z.object({
  waId: WaIdField,
  name: z.string().min(1).max(120).optional(),
})

export type FindOrCreateWhatsAppContactDTO = z.infer<
  typeof FindOrCreateWhatsAppContactSchema
>

export const ListWhatsAppContactsSchema = z.object({
  search: z.string().max(120).optional(),
  /** Filtro "tem zap?": com WhatsApp, sem WhatsApp ou ainda não verificado. */
  whatsapp: z.enum(['yes', 'no', 'unknown']).optional(),
  /** Only contacts inserted today (São Paulo calendar day). */
  created: z.enum(['today']).optional(),
})

export type ListWhatsAppContactsDTO = z.infer<typeof ListWhatsAppContactsSchema>
