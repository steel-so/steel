import z from 'zod'

const id = z.string().min(1).max(64)

/**
 * Anchors the 360 view can start from. Exactly one is enough; when several
 * are sent the most specific wins (person, then company, then the rest).
 */
export const Customer360QuerySchema = z
  .object({
    personId: id.optional(),
    companyId: id.optional(),
    /** Raw phone of a WhatsApp contact or a caller (any format). */
    phone: z.string().min(1).max(40).optional(),
    /** Id of a ServiceDesk ticket: its customer / contact anchor the view. */
    ticketId: id.optional(),
    /** Id of a WhatsApp conversation: its contact phone anchors the view. */
    conversationId: id.optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.personId ||
          value.companyId ||
          value.phone ||
          value.ticketId ||
          value.conversationId,
      ),
    { message: 'Informe a pessoa, a empresa, o telefone, o chamado ou a conversa' },
  )

export type Customer360Query = z.infer<typeof Customer360QuerySchema>

/** Opens the WhatsApp conversation of a CRM record (person, company or deal). */
export const OpenCustomerWhatsappSchema = z
  .object({
    personId: id.optional(),
    companyId: id.optional(),
    opportunityId: id.optional(),
    /** Which phone of the record; defaults to the first usable one. */
    phone: z.string().min(1).max(40).optional(),
  })
  .refine((value) => Boolean(value.personId || value.companyId || value.opportunityId), {
    message: 'Informe a pessoa, a empresa ou a oportunidade',
  })

export type OpenCustomerWhatsappInput = z.infer<typeof OpenCustomerWhatsappSchema>
