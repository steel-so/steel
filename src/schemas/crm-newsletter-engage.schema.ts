import z from 'zod'
import { CrmCampaignLegalBasisEnum } from './crm-campaign.schema'
import { CRM_NEWSLETTER_DELIVERY_STATUSES } from './crm-newsletter-issue.schema'

/**
 * Engagement of a newsletter issue (slice nl2-engage): the "Enquete" block
 * (votes, results, voters) and the WhatsApp version ("Enviar também no
 * WhatsApp") with its per-number delivery report.
 */

// ─── polls ────────────────────────────────────────────────────────────────

/** Voters listed per poll in the report (the CSV has every vote). */
export const CRM_NEWSLETTER_POLL_VOTERS_LIMIT = 200

export type CrmNewsletterPollOptionDTO = {
  index: number
  label: string
  votes: number
}

export type CrmNewsletterPollVoterDTO = {
  id: string
  name: string | null
  email: string
  /** CRM person of the subscriber, when linked (opens the person page). */
  personId: string | null
  optionIndex: number
  votedAt: string
}

export type CrmNewsletterPollReportDTO = {
  blockId: string
  question: string
  showResults: boolean
  totalVotes: number
  options: CrmNewsletterPollOptionDTO[]
  voters: CrmNewsletterPollVoterDTO[]
  /** True when there are more voters than the report lists. */
  votersTruncated: boolean
}

export type CrmNewsletterIssuePollsDTO = {
  polls: CrmNewsletterPollReportDTO[]
}

/** What the public thank-you page shows after a vote. */
export type CrmNewsletterPollVoteResultDTO = {
  newsletterName: string
  question: string
  chosenIndex: number
  chosenLabel: string
  /** True when this request changed an earlier vote. */
  changed: boolean
  /** `null` when the author hid the results. */
  results: { totalVotes: number; options: CrmNewsletterPollOptionDTO[] } | null
}

// ─── WhatsApp version ─────────────────────────────────────────────────────

/** Where a Meta template variable takes its value from. `summary` = the
 * issue excerpt, `subject` = the issue subject, `link`/`link_code` = the
 * web version of the issue (or its path, for URL buttons). */
export const CRM_NEWSLETTER_WA_VARIABLE_SOURCES = [
  'name',
  'first_name',
  'link',
  'link_code',
  'summary',
  'subject',
  'static',
] as const
export type CrmNewsletterWhatsAppVariableSourceKind =
  (typeof CRM_NEWSLETTER_WA_VARIABLE_SOURCES)[number]

export const CrmNewsletterWhatsAppVariableSourceSchema = z
  .object({
    source: z.enum(CRM_NEWSLETTER_WA_VARIABLE_SOURCES),
    value: z.string().max(500).optional(),
  })
  .refine((v) => v.source !== 'static' || Boolean(v.value?.trim()), {
    message: 'Informe o texto fixo da variável',
    path: ['value'],
  })

const VariableMapSchema = z.record(
  z.string().regex(/^\d+$/),
  CrmNewsletterWhatsAppVariableSourceSchema,
)

export const CrmNewsletterWhatsAppVariablesSchema = z.object({
  header: VariableMapSchema.default({}),
  body: VariableMapSchema.default({}),
  buttons: VariableMapSchema.default({}),
})
export type CrmNewsletterWhatsAppVariables = z.infer<
  typeof CrmNewsletterWhatsAppVariablesSchema
>

/** Tokens of the Z-API text on top of {nome}, {primeiro_nome} and {link}. */
export const NEWSLETTER_WA_TEXT_TOKENS = {
  summary: '{resumo}',
  subject: '{assunto}',
} as const

export const CRM_NEWSLETTER_WA_TEXT_MAX = 1000

export const DEFAULT_NEWSLETTER_WA_TEXT =
  'Olá, {primeiro_nome}! Saiu uma nova edição: *{assunto}*\n\n{resumo}\n\nLeia aqui: {link}'

export const UpdateCrmNewsletterIssueWhatsAppSchema = z
  .object({
    enabled: z.boolean(),
    connectionId: z.string().min(1).nullable(),
    templateId: z.string().min(1).nullable(),
    variables: CrmNewsletterWhatsAppVariablesSchema.nullable(),
    text: z.string().max(CRM_NEWSLETTER_WA_TEXT_MAX).nullable(),
    legalBasis: CrmCampaignLegalBasisEnum.nullable(),
    /** Records who declared the legal basis (and when). */
    confirmLegalBasis: z.boolean(),
  })
  .partial()
export type UpdateCrmNewsletterIssueWhatsAppDTO = z.infer<
  typeof UpdateCrmNewsletterIssueWhatsAppSchema
>

export type CrmNewsletterWhatsAppReachDTO = {
  /** Active subscribers linked to a CRM person. */
  linked: number
  /** …with a WhatsApp-able phone and not opted out: who gets it. */
  reachable: number
  /** Linked people without a usable phone. */
  missingPhone: number
  /** Numbers that asked to stop receiving broadcasts (SAIR/PARAR). */
  optedOut: number
}

export type CrmNewsletterIssueWhatsAppDTO = {
  issueId: string
  enabled: boolean
  connectionId: string | null
  templateId: string | null
  variables: CrmNewsletterWhatsAppVariables | null
  text: string | null
  legalBasis: z.infer<typeof CrmCampaignLegalBasisEnum> | null
  consentConfirmedAt: string | null
  startedAt: string | null
  /** False when the Comunicação module is off (with the reason). */
  available: boolean
  unavailableReason: string | null
  /** pt-BR problems that keep the WhatsApp version from going out. */
  problems: string[]
  /** Who would get it now (DRAFT/SCHEDULED issues only). */
  reach: CrmNewsletterWhatsAppReachDTO | null
}

/** Why a WhatsApp row was SKIPPED. */
export const CRM_NEWSLETTER_WA_SKIP_REASONS = [
  'OPTED_OUT',
  'LIMIT_REACHED',
  'UNAVAILABLE',
  'STOPPED',
] as const

export type CrmNewsletterWhatsAppStatsDTO = {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
}

export const ListCrmNewsletterWhatsAppRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(CRM_NEWSLETTER_DELIVERY_STATUSES).optional(),
})
export type ListCrmNewsletterWhatsAppRecipientsQuery = z.infer<
  typeof ListCrmNewsletterWhatsAppRecipientsQuerySchema
>

export type CrmNewsletterWhatsAppRecipientDTO = {
  id: string
  name: string
  /** E.164 display form, e.g. `+5511999990000`. */
  phone: string
  personId: string | null
  status: (typeof CRM_NEWSLETTER_DELIVERY_STATUSES)[number]
  skipReason: string | null
  error: string | null
  sentAt: string | null
}

export type CrmNewsletterWhatsAppReportDTO = {
  enabled: boolean
  provider: 'META' | 'ZAPI' | null
  stats: CrmNewsletterWhatsAppStatsDTO
  items: CrmNewsletterWhatsAppRecipientDTO[]
  total: number
  page: number
  pageSize: number
}
