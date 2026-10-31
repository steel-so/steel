import { z } from 'zod'
import { PROSPECT_SIGNAL_TYPES } from '@/src/lib/prospecting/signals'

/** Prospecting agent (T5): settings, drafts and the agent preset. */

export const CrmProspectChannelSchema = z.enum(['EMAIL', 'WHATSAPP'])
export const CrmProspectDraftStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SENT',
])
export const CrmProspectSignalTypeSchema = z.enum(PROSPECT_SIGNAL_TYPES)

export const PROSPECT_EMAIL_BODY_MAX = 4000
export const PROSPECT_WHATSAPP_BODY_MAX = 1000
export const PROSPECT_MAX_SIGNALS = 8
export const PROSPECT_MAX_SOURCES = 10

/* --------------------------------- settings -------------------------------- */

export const UpdateCrmProspectingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    monthlyWebLimit: z.number().int().min(0).max(100_000),
    monthlyDraftLimit: z.number().int().min(0).max(100_000),
    allowedChannels: z
      .array(CrmProspectChannelSchema)
      .min(1, 'Deixe ao menos um canal')
      .max(2)
      .transform((channels) => Array.from(new Set(channels))),
    valueProposition: z.string().trim().max(2000).nullable(),
    signalKeywords: z
      .array(z.string().trim().min(3).max(60))
      .max(30)
      .transform((words) => Array.from(new Set(words))),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateCrmProspectingSettingsDTO = z.infer<
  typeof UpdateCrmProspectingSettingsSchema
>

/* ---------------------------------- drafts --------------------------------- */

export const CrmProspectSignalSchema = z.object({
  type: CrmProspectSignalTypeSchema,
  evidence: z.string().trim().min(3).max(400),
  sourceUrl: z.url().max(500).nullish(),
})
export type CrmProspectSignalInput = z.infer<typeof CrmProspectSignalSchema>

export const CrmProspectSourceSchema = z.object({
  url: z.url().max(500),
  title: z.string().trim().max(200).nullish(),
})

const idField = z.string().trim().min(1).max(64)

/** What the agent hands to `crm_prospect_save_draft`. */
export const CreateCrmProspectDraftSchema = z
  .object({
    leadId: idField.nullish(),
    companyId: idField.nullish(),
    personId: idField.nullish(),
    channel: CrmProspectChannelSchema,
    subject: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(20, 'Escreva a mensagem').max(
      PROSPECT_EMAIL_BODY_MAX,
    ),
    toEmail: z.email().max(254).nullish(),
    toPhone: z.string().trim().max(30).nullish(),
    summary: z.string().trim().max(2000).nullish(),
    signals: z.array(CrmProspectSignalSchema).max(PROSPECT_MAX_SIGNALS).default([]),
    sources: z.array(CrmProspectSourceSchema).max(PROSPECT_MAX_SOURCES).default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.leadId && !value.companyId && !value.personId) {
      ctx.addIssue({
        code: 'custom',
        path: ['leadId'],
        message: 'Informe o lead, a empresa ou a pessoa do rascunho',
      })
    }
    if (value.channel === 'EMAIL' && !value.subject) {
      ctx.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Informe o assunto do e-mail',
      })
    }
    if (
      value.channel === 'WHATSAPP' &&
      value.body.length > PROSPECT_WHATSAPP_BODY_MAX
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `A mensagem de WhatsApp tem no máximo ${PROSPECT_WHATSAPP_BODY_MAX} caracteres`,
      })
    }
  })
export type CreateCrmProspectDraftDTO = z.infer<
  typeof CreateCrmProspectDraftSchema
>

export const UpdateCrmProspectDraftSchema = z
  .object({
    subject: z.string().trim().max(200).nullable(),
    body: z.string().trim().min(20).max(PROSPECT_EMAIL_BODY_MAX),
    toEmail: z.email().max(254).nullable(),
    toPhone: z.string().trim().max(30).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateCrmProspectDraftDTO = z.infer<
  typeof UpdateCrmProspectDraftSchema
>

export const ListCrmProspectDraftsQuerySchema = z.object({
  status: CrmProspectDraftStatusSchema.optional(),
  leadId: idField.optional(),
  companyId: idField.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListCrmProspectDraftsQuery = z.infer<
  typeof ListCrmProspectDraftsQuerySchema
>

export const DecideCrmProspectDraftSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'MARK_SENT']),
    reason: z.string().trim().max(500).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECT' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Diga por que o rascunho foi recusado',
      })
    }
  })
export type DecideCrmProspectDraftDTO = z.infer<
  typeof DecideCrmProspectDraftSchema
>

/* ------------------------------- agent preset ------------------------------ */

export const CreateCrmProspectingAgentSchema = z.object({
  /** `ASSIGNMENT`: runs when a lead is assigned to the agent. `NEW_LEAD`: on every new lead. */
  trigger: z.enum(['ASSIGNMENT', 'NEW_LEAD']).default('ASSIGNMENT'),
  /** Who the agent acts as; defaults to whoever creates it. */
  ownerId: idField.optional(),
})
export type CreateCrmProspectingAgentDTO = z.infer<
  typeof CreateCrmProspectingAgentSchema
>
