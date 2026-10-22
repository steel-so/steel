import { z } from 'zod'
import { NUMBER_CHECK_MAX_CONTACTS } from '@/src/lib/whatsapp/number-check'

/**
 * Starts a "tem zap?" check. Exactly one source: selected contacts (or all of
 * them), a broadcast list, or an AI campaign's contacts.
 */
export const StartWhatsAppNumberValidationSchema = z
  .object({
    scope: z.enum(['CONTACTS', 'BROADCAST', 'AI_CAMPAIGN']),
    contactIds: z
      .array(z.string().min(1))
      .min(1)
      .max(NUMBER_CHECK_MAX_CONTACTS)
      .optional(),
    /** Every contact of the workspace (capped). */
    all: z.boolean().optional(),
    broadcastId: z.string().min(1).optional(),
    campaignId: z.string().min(1).optional(),
    /** Z-API connection to ask; defaults to a connected one. */
    connectionId: z.string().min(1).optional(),
    /** Ignore the cache (TTL) and check everyone again. */
    force: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (value.scope === 'CONTACTS' && !value.all && !value.contactIds) {
      issue('contactIds', 'Selecione os contatos ou escolha validar todos')
    }
    if (value.scope === 'BROADCAST' && !value.broadcastId) {
      issue('broadcastId', 'Informe a lista de transmissão')
    }
    if (value.scope === 'AI_CAMPAIGN' && !value.campaignId) {
      issue('campaignId', 'Informe a campanha de IA')
    }
  })

export type StartWhatsAppNumberValidationDTO = z.infer<
  typeof StartWhatsAppNumberValidationSchema
>
