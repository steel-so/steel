import z from 'zod'
import { CrmCampaignLegalBasisEnum } from './crm-campaign.schema'

/**
 * CRM newsletter — publications and subscribers (ADR 0054,
 * docs/crm-newsletter/README.md). Issues live in
 * crm-newsletter-issue.schema.ts.
 */

export const CRM_NEWSLETTER_STATUSES = ['ACTIVE', 'ARCHIVED'] as const

export const CRM_NEWSLETTER_SUBSCRIBER_STATUSES = [
  'PENDING',
  'ACTIVE',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
] as const
export type CrmNewsletterSubscriberStatusValue =
  (typeof CRM_NEWSLETTER_SUBSCRIBER_STATUSES)[number]

export const CRM_NEWSLETTER_SUBSCRIBER_SOURCES = [
  'FORM',
  'SITE',
  'PUBLIC_PAGE',
  'API',
  'IMPORT',
  'MANUAL',
] as const
export type CrmNewsletterSubscriberSourceValue =
  (typeof CRM_NEWSLETTER_SUBSCRIBER_SOURCES)[number]

/** Double opt-in links expire after this many days. */
export const CRM_NEWSLETTER_CONFIRM_TTL_DAYS = 7
/** Rows accepted per CSV import. */
export const CRM_NEWSLETTER_IMPORT_MAX_ROWS = 50_000
/** Default consent text when the newsletter does not set one. */
export const CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT =
  'Quero receber esta newsletter por e-mail. Posso cancelar quando quiser.'

export const CrmNewsletterSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use pelo menos 2 caracteres')
  .max(60, 'Use no máximo 60 caracteres')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use só letras minúsculas sem acento, números e hífen',
  )

const SenderEmailSchema = z.email('E-mail do remetente inválido').max(254)

export const CreateCrmNewsletterSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  /** Omitted → derived from the name. */
  slug: CrmNewsletterSlugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  cadenceLabel: z.string().trim().max(40).optional(),
  fromName: z.string().trim().min(1, 'Nome do remetente é obrigatório').max(80),
  /** Must be on a VERIFIED sending domain of the workspace. */
  fromEmail: SenderEmailSchema,
  replyTo: z.email('E-mail de resposta inválido').max(254).optional(),
  templateId: z.string().min(1).optional(),
  doubleOptIn: z.boolean().default(true),
  legalBasis: CrmCampaignLegalBasisEnum.default('CONSENT'),
  archiveEnabled: z.boolean().default(true),
})

export type CreateCrmNewsletterDTO = z.infer<typeof CreateCrmNewsletterSchema>

export const UpdateCrmNewsletterSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    slug: CrmNewsletterSlugSchema,
    description: z.string().trim().max(2000).nullable(),
    cadenceLabel: z.string().trim().max(40).nullable(),
    fromName: z.string().trim().min(1).max(80),
    fromEmail: SenderEmailSchema,
    replyTo: z.email('E-mail de resposta inválido').max(254).nullable(),
    templateId: z.string().min(1).nullable(),
    doubleOptIn: z.boolean(),
    legalBasis: CrmCampaignLegalBasisEnum,
    archiveEnabled: z.boolean(),
    status: z.enum(CRM_NEWSLETTER_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateCrmNewsletterDTO = z.infer<typeof UpdateCrmNewsletterSchema>

export type CrmNewsletterDTO = {
  id: string
  name: string
  slug: string
  description: string | null
  cadenceLabel: string | null
  fromName: string
  fromEmail: string
  replyTo: string | null
  sendingDomainId: string | null
  /** False while the From domain is not VERIFIED: sending is blocked. */
  senderVerified: boolean
  templateId: string | null
  doubleOptIn: boolean
  legalBasis: z.infer<typeof CrmCampaignLegalBasisEnum>
  archiveEnabled: boolean
  status: (typeof CRM_NEWSLETTER_STATUSES)[number]
  counts: { active: number; pending: number; issuesSent: number }
  lastIssueSentAt: string | null
  /** Public archive URL (null when the archive is off). */
  archiveUrl: string | null
  createdAt: string
  updatedAt: string
}

// ─── Subscribers ───────────────────────────────────────────────────────────

export const AddCrmNewsletterSubscriberSchema = z.object({
  email: z.email('E-mail inválido').max(254),
  name: z.string().trim().max(200).optional(),
  /**
   * Manual add by a member: ACTIVE right away (the member vouches for the
   * consent, recorded in `consentText`), unless `sendConfirmation` asks for
   * the double opt-in e-mail.
   */
  sendConfirmation: z.boolean().default(false),
  consentNote: z.string().trim().max(500).optional(),
})

export type AddCrmNewsletterSubscriberDTO = z.infer<
  typeof AddCrmNewsletterSubscriberSchema
>

export const ListCrmNewsletterSubscribersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  status: z.enum(CRM_NEWSLETTER_SUBSCRIBER_STATUSES).optional(),
  source: z.enum(CRM_NEWSLETTER_SUBSCRIBER_SOURCES).optional(),
})

export type ListCrmNewsletterSubscribersQuery = z.infer<
  typeof ListCrmNewsletterSubscribersQuerySchema
>

/**
 * CSV import: the client parses the file and posts the rows (columns
 * `email`, optional `name`). `consentConfirmed` is the member's statement
 * that these people agreed to receive the newsletter (LGPD) — required.
 */
export const ImportCrmNewsletterSubscribersSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().trim().max(254),
        name: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, 'O arquivo não tem linhas')
    .max(CRM_NEWSLETTER_IMPORT_MAX_ROWS),
  consentConfirmed: z.literal(true, {
    error: 'Confirme que essas pessoas autorizaram o envio',
  }),
  /** Send the double opt-in e-mail instead of activating right away. */
  sendConfirmation: z.boolean().default(false),
})

export type ImportCrmNewsletterSubscribersDTO = z.infer<
  typeof ImportCrmNewsletterSubscribersSchema
>

export type CrmNewsletterImportResultDTO = {
  created: number
  reactivated: number
  /** Already ACTIVE/PENDING. */
  unchanged: number
  /** Invalid e-mail, global opt-out, bounced or complained. */
  rejected: { row: number; email: string; reason: string }[]
}

export type CrmNewsletterSubscriberDTO = {
  id: string
  email: string
  name: string | null
  personId: string | null
  status: CrmNewsletterSubscriberStatusValue
  source: CrmNewsletterSubscriberSourceValue
  consentAt: string | null
  confirmedAt: string | null
  unsubscribedAt: string | null
  unsubscribeReason: string | null
  lastSentAt: string | null
  lastOpenedAt: string | null
  lastClickedAt: string | null
  createdAt: string
}

// ─── Public (no session) ───────────────────────────────────────────────────

/**
 * POST /api/newsletters/subscribe — public subscribe page, the Sites
 * subscribe element and any external site. Rate limited per IP and e-mail.
 */
export const PublicNewsletterSubscribeSchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
  newsletterSlug: CrmNewsletterSlugSchema,
  email: z.email('E-mail inválido').max(254),
  name: z.string().trim().max(200).optional(),
  consent: z.literal(true, { error: 'Marque a autorização para assinar' }),
  /** Where the form was: `SITE` (+ siteId) or `PUBLIC_PAGE`. */
  source: z.enum(['SITE', 'PUBLIC_PAGE', 'API']).default('PUBLIC_PAGE'),
  sourceRef: z.string().max(60).optional(),
  /** Honeypot: must stay empty. */
  website: z.string().max(0).optional(),
})

export type PublicNewsletterSubscribeDTO = z.infer<
  typeof PublicNewsletterSubscribeSchema
>

/** Preference center: the e-mail's subscriptions in one workspace. */
export const UpdateNewsletterPreferencesSchema = z.object({
  /** Newsletter ids that stay (or become) subscribed; the rest leave. */
  subscribedNewsletterIds: z.array(z.string().min(1)).max(200),
  /** "Sair de tudo": also writes the workspace-wide CrmEmailOptOut. */
  unsubscribeAll: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
})

export type UpdateNewsletterPreferencesDTO = z.infer<
  typeof UpdateNewsletterPreferencesSchema
>

export type NewsletterPreferencesDTO = {
  workspaceName: string
  email: string
  /** True when the address is in the workspace-wide opt-out. */
  optedOutOfAll: boolean
  newsletters: {
    id: string
    name: string
    description: string | null
    cadenceLabel: string | null
    subscribed: boolean
  }[]
}

// ─── Platform admin ────────────────────────────────────────────────────────

export const UpdateCrmNewsletterSettingsSchema = z.object({
  /** Null = back to the plan's `newsletterEmailsPerMonth`. */
  monthlyEmailLimitOverride: z
    .number()
    .int()
    .positive()
    .max(10_000_000)
    .nullable(),
})

export type UpdateCrmNewsletterSettingsDTO = z.infer<
  typeof UpdateCrmNewsletterSettingsSchema
>

export type CrmNewsletterUsageDTO = {
  /** "YYYY-MM" in America/Sao_Paulo. */
  month: string
  emailsSent: number
  /** Null = unlimited. */
  limit: number | null
  limitSource: 'PLAN' | 'OVERRIDE'
}
