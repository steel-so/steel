import z from 'zod'
import { EmailCanvasDocumentSchema } from './crm-email-builder.schema'
import { CrmNewsletterSlugSchema } from './crm-newsletter.schema'

/**
 * Newsletter issues (editions) — ADR 0054. Content is a Steel Canvas
 * e-mail document; sending runs on the `crm-newsletter` worker queue.
 */

export const CRM_NEWSLETTER_ISSUE_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELED',
  'FAILED',
] as const
export type CrmNewsletterIssueStatusValue =
  (typeof CRM_NEWSLETTER_ISSUE_STATUSES)[number]

export const CRM_NEWSLETTER_DELIVERY_STATUSES = [
  'PENDING',
  'SENDING',
  'SENT',
  'SKIPPED',
  'FAILED',
] as const

/** Why a recipient was SKIPPED at send time. */
export const CRM_NEWSLETTER_SKIP_REASONS = [
  'OPTED_OUT',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'LIMIT_REACHED',
  /** "Parar envio" during SENDING (nl-issues). */
  'STOPPED',
] as const
export type CrmNewsletterSkipReason =
  (typeof CRM_NEWSLETTER_SKIP_REASONS)[number]

/** Test sends per issue per hour (they do not count toward the quota). */
export const CRM_NEWSLETTER_TEST_SENDS_PER_HOUR = 10
/** Minimum lead time of a scheduled send. */
export const CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES = 5

export const CreateCrmNewsletterIssueSchema = z.object({
  subject: z.string().trim().min(1, 'Assunto é obrigatório').max(200),
  preheader: z.string().trim().max(200).optional(),
  /** Omitted → derived from the subject. */
  slug: CrmNewsletterSlugSchema.optional(),
  /** Start from this template (v2); omitted → the newsletter's default. */
  templateId: z.string().min(1).optional(),
  /** Duplicate another issue of the same newsletter. */
  duplicateOfIssueId: z.string().min(1).optional(),
})

export type CreateCrmNewsletterIssueDTO = z.infer<
  typeof CreateCrmNewsletterIssueSchema
>

/** Autosave of the editor and the settings panel (DRAFT/SCHEDULED only). */
export const UpdateCrmNewsletterIssueSchema = z
  .object({
    subject: z.string().trim().min(1, 'Assunto é obrigatório').max(200),
    preheader: z.string().trim().max(200).nullable(),
    slug: CrmNewsletterSlugSchema,
    builderDocument: EmailCanvasDocumentSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateCrmNewsletterIssueDTO = z.infer<
  typeof UpdateCrmNewsletterIssueSchema
>

export const CrmNewsletterIssueTestSendSchema = z.object({
  emails: z
    .array(z.email('E-mail inválido'))
    .min(1, 'Informe ao menos um e-mail')
    .max(5, 'No máximo 5 e-mails por teste'),
})

export type CrmNewsletterIssueTestSendDTO = z.infer<
  typeof CrmNewsletterIssueTestSendSchema
>

/** `scheduledAt` omitted → send now. */
export const SendCrmNewsletterIssueSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
})

export type SendCrmNewsletterIssueDTO = z.infer<
  typeof SendCrmNewsletterIssueSchema
>

export const ListCrmNewsletterIssuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(CRM_NEWSLETTER_ISSUE_STATUSES).optional(),
})

export type ListCrmNewsletterIssuesQuery = z.infer<
  typeof ListCrmNewsletterIssuesQuerySchema
>

export type CrmNewsletterIssueStatsDTO = {
  recipients: number
  sent: number
  skipped: number
  failed: number
  delivered: number
  /** Unique opens (Apple Mail Privacy inflates this — shown with a hint). */
  opened: number
  /** Unique clickers. */
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
}

export type CrmNewsletterIssueDTO = {
  id: string
  newsletterId: string
  number: number | null
  subject: string
  preheader: string | null
  slug: string
  status: CrmNewsletterIssueStatusValue
  scheduledAt: string | null
  sendingStartedAt: string | null
  sentAt: string | null
  canceledAt: string | null
  failureReason: string | null
  /** Only on the detail endpoint. */
  builderDocument?: unknown
  stats: CrmNewsletterIssueStatsDTO | null
  /** Web version (null while not sent or when the archive is off). */
  webUrl: string | null
  createdAt: string
  updatedAt: string
}

export type CrmNewsletterIssueLinkStatDTO = {
  url: string
  clicks: number
  uniqueClickers: number
}

// ─── Public archive ────────────────────────────────────────────────────────

export type PublicNewsletterArchiveDTO = {
  workspaceName: string
  workspaceSlug: string
  newsletter: {
    name: string
    slug: string
    description: string | null
    cadenceLabel: string | null
    logoUrl: string | null
    primaryColor: string | null
  }
  issues: {
    number: number
    subject: string
    slug: string
    excerpt: string | null
    sentAt: string
  }[]
}

// ─── Issue report and send dialog (nl-issues) ──────────────────────────────

/** Recipient filters of the issue report. */
export const CRM_NEWSLETTER_RECIPIENT_FILTERS = [
  'all',
  'delivered',
  'opened',
  'not_opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'failed',
  'skipped',
] as const
export type CrmNewsletterRecipientFilter =
  (typeof CRM_NEWSLETTER_RECIPIENT_FILTERS)[number]

export const ListCrmNewsletterIssueRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  filter: z.enum(CRM_NEWSLETTER_RECIPIENT_FILTERS).default('all'),
  search: z.string().trim().max(120).optional(),
})

export type ListCrmNewsletterIssueRecipientsQuery = z.infer<
  typeof ListCrmNewsletterIssueRecipientsQuerySchema
>

export type CrmNewsletterIssueRecipientDTO = {
  id: string
  email: string
  name: string | null
  status: (typeof CRM_NEWSLETTER_DELIVERY_STATUSES)[number]
  skipReason: string | null
  error: string | null
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
  unsubscribedAt: string | null
}

export type CrmNewsletterIssueReportDTO = {
  stats: CrmNewsletterIssueStatsDTO
  links: CrmNewsletterIssueLinkStatDTO[]
}

/** One pre-send check of the send dialog. */
export type CrmNewsletterPreflightCheckDTO = {
  code:
    | 'NEWSLETTER_ARCHIVED'
    | 'SENDER_NOT_VERIFIED'
    | 'CONTENT_INVALID'
    | 'NO_SUBSCRIBERS'
    | 'LIMIT_REACHED'
  message: string
}

/** What the send/schedule dialog shows before confirming. */
export type CrmNewsletterIssuePreflightDTO = {
  /** ACTIVE subscribers minus the workspace-wide opt-out. */
  audience: number
  usage: {
    month: string
    emailsSent: number
    limit: number | null
    limitSource: 'PLAN' | 'OVERRIDE'
  }
  /** Null = unlimited. */
  remaining: number | null
  senderVerified: boolean
  /** Editor checklist (errors block the send, warnings do not). */
  checklist: {
    code: string
    level: 'error' | 'warning'
    message: string
  }[]
  /** Empty = ready to send. In the order the send checks them. */
  blockers: CrmNewsletterPreflightCheckDTO[]
}

/** Newsletter overview: the last sent issues, oldest first. */
export type CrmNewsletterIssueTrendDTO = {
  issues: {
    id: string
    number: number | null
    subject: string
    sentAt: string | null
    recipients: number
    openRate: number | null
    clickRate: number | null
  }[]
}
