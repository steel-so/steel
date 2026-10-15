import z from 'zod'
import { CrmLeadStageEnum } from './crm-lead.schema'

export const CRM_CAMPAIGN_LEGAL_BASES = [
  'CONSENT',
  'LEGITIMATE_INTEREST',
  'CONTRACT',
] as const

export const CrmCampaignLegalBasisEnum = z.enum(CRM_CAMPAIGN_LEGAL_BASES)

export const CrmCampaignDestinationTypeEnum = z.enum([
  'LANDING_PAGE',
  'FORM',
  'SITE_PAGE',
])

export const CrmCampaignChannelEnum = z.enum(['EMAIL', 'WHATSAPP'])

/** Who receives the campaign. Sources are unioned and deduplicated. */
export const CrmCampaignAudienceSchema = z.object({
  mailingListIds: z.array(z.string().min(1)).max(50).default([]),
  allPeople: z.boolean().default(false),
  leadStages: z.array(CrmLeadStageEnum).max(6).default([]),
})

export type CrmCampaignAudience = z.infer<typeof CrmCampaignAudienceSchema>

/** Where the value of a Meta template variable comes from. */
export const CRM_CAMPAIGN_VARIABLE_SOURCES = [
  'name',
  'first_name',
  'link',
  'link_code',
  'static',
] as const

export const CrmCampaignVariableSourceSchema = z
  .object({
    source: z.enum(CRM_CAMPAIGN_VARIABLE_SOURCES),
    value: z.string().max(500).optional(),
  })
  .refine((v) => v.source !== 'static' || Boolean(v.value?.trim()), {
    message: 'Informe o texto fixo da variável',
    path: ['value'],
  })

export type CrmCampaignVariableSource = z.infer<
  typeof CrmCampaignVariableSourceSchema
>

const VariableMapSchema = z.record(
  z.string().regex(/^\d+$/),
  CrmCampaignVariableSourceSchema,
)

export const CrmCampaignWhatsAppVariablesSchema = z.object({
  header: VariableMapSchema.default({}),
  body: VariableMapSchema.default({}),
  buttons: VariableMapSchema.default({}),
})

export type CrmCampaignWhatsAppVariables = z.infer<
  typeof CrmCampaignWhatsAppVariablesSchema
>

export const CreateCrmCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome à campanha').max(120),
})

export type CreateCrmCampaignDTO = z.infer<typeof CreateCrmCampaignSchema>

const nullableId = z.string().min(1).nullable().optional()

/** Draft edits — every field is optional so the wizard saves any time. */
export const UpdateCrmCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Dê um nome à campanha').max(120),
    utmMedium: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_-]+$/i, 'Use letras, números, "-" ou "_"'),
    destinationType: CrmCampaignDestinationTypeEnum.nullable(),
    landingPageId: nullableId,
    formId: nullableId,
    siteId: nullableId,
    sitePageId: nullableId,
    emailFrom: z.email('Remetente inválido').nullable(),
    emailSubject: z.string().trim().max(200).nullable(),
    emailPreheader: z.string().trim().max(200).nullable(),
    emailTemplateId: nullableId,
    emailLegalBasis: CrmCampaignLegalBasisEnum.nullable(),
    audience: CrmCampaignAudienceSchema,
    whatsappEnabled: z.boolean(),
    whatsappConnectionId: nullableId,
    whatsappTemplateId: nullableId,
    whatsappVariables: CrmCampaignWhatsAppVariablesSchema.nullable(),
    whatsappText: z.string().max(4000).nullable(),
    whatsappMediaUrl: z.url('Link de mídia inválido').max(1000).nullable(),
    whatsappQuickReplyId: nullableId,
    whatsappDelayHours: z.number().int().min(0).max(720),
    whatsappLegalBasis: CrmCampaignLegalBasisEnum.nullable(),
    scheduledAt: z.coerce.date().nullable(),
    sendWindowStartHour: z.number().int().min(0).max(23).nullable(),
    sendWindowEndHour: z.number().int().min(1).max(24).nullable(),
    sendWeekdaysOnly: z.boolean(),
  })
  .partial()
  .refine(
    (v) =>
      v.sendWindowStartHour == null ||
      v.sendWindowEndHour == null ||
      v.sendWindowStartHour !== v.sendWindowEndHour,
    {
      message: 'O início e o fim da janela de envio precisam ser diferentes',
      path: ['sendWindowEndHour'],
    },
  )

export type UpdateCrmCampaignDTO = z.infer<typeof UpdateCrmCampaignSchema>

export const LaunchCrmCampaignSchema = z.object({
  /** Who launches declares the legal basis (LGPD) of every active channel. */
  confirmLegalBasis: z.literal(true, {
    error: 'Confirme a base legal para o envio',
  }),
})

export type LaunchCrmCampaignDTO = z.infer<typeof LaunchCrmCampaignSchema>

export const ControlCrmCampaignSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
})

export type ControlCrmCampaignDTO = z.infer<typeof ControlCrmCampaignSchema>

export const CrmCampaignAudiencePreviewSchema = z.object({
  audience: CrmCampaignAudienceSchema,
  whatsappEnabled: z.boolean().default(false),
})

export type CrmCampaignAudiencePreviewInput = z.infer<
  typeof CrmCampaignAudiencePreviewSchema
>

export const CrmCampaignTestSendSchema = z
  .object({
    email: z.email('E-mail inválido').optional(),
    phone: z.string().trim().min(8).max(20).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Informe um e-mail ou um WhatsApp para o teste',
    path: ['email'],
  })

export type CrmCampaignTestSendDTO = z.infer<typeof CrmCampaignTestSendSchema>

export const ListCrmCampaignRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
})

export type ListCrmCampaignRecipientsQuery = z.infer<
  typeof ListCrmCampaignRecipientsQuerySchema
>

/**
 * Campaign parameters a public landing page / form forwards with the visit
 * or the submission (read from its own URL).
 */
export const CrmCampaignRefSchema = z.object({
  ref: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmSource: z.string().max(200).optional(),
  /** Site page the form was sent from (the `site.form` element). */
  siteSlug: z.string().max(80).optional(),
  sitePageId: z.string().max(40).optional(),
})

export type CrmCampaignRefDTO = z.infer<typeof CrmCampaignRefSchema>

/** Resend webhook event (only the fields the campaign tracking reads). */
export const ResendWebhookEventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().min(1),
    })
    .loose(),
})

export type ResendWebhookEvent = z.infer<typeof ResendWebhookEventSchema>
