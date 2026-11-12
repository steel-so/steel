import { z } from 'zod'

/** Longest reason a member can write for a block. */
export const WHATSAPP_CONTACT_BLOCK_REASON_MAX = 500

/**
 * Block a contact on a WhatsApp number (zap-block-contacts). From the inbox
 * the conversation says who and on which number; from elsewhere (contact
 * list, settings) the number and the contact are given.
 */
export const CreateWhatsAppContactBlockSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    reason: z
      .string()
      .trim()
      .max(
        WHATSAPP_CONTACT_BLOCK_REASON_MAX,
        `O motivo pode ter até ${WHATSAPP_CONTACT_BLOCK_REASON_MAX} caracteres`,
      )
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .refine(
    (value) =>
      Boolean(value.conversationId) ||
      Boolean(value.connectionId && value.contactId),
    {
      message: 'Informe a conversa, ou o número e o contato',
      path: ['conversationId'],
    },
  )

export type CreateWhatsAppContactBlockDTO = z.infer<
  typeof CreateWhatsAppContactBlockSchema
>

/** `GET .../whatsapp/blocks`: optionally one number only. */
export const WhatsAppContactBlockQuerySchema = z.object({
  connectionId: z.string().min(1).optional(),
})

export type WhatsAppContactBlockQueryDTO = z.infer<
  typeof WhatsAppContactBlockQuerySchema
>

/** `POST .../whatsapp/blocks/sync`: every number, or just one. */
export const SyncWhatsAppContactBlocksSchema = z.object({
  connectionId: z.string().min(1).optional(),
})

export type SyncWhatsAppContactBlocksDTO = z.infer<
  typeof SyncWhatsAppContactBlocksSchema
>
