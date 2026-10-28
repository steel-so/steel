import type {
  CrmNewsletterIssue,
  CrmNewsletterIssueRecipient,
  CrmNewsletterSettings,
  CrmNewsletterUsageMonthly,
} from '@prisma/client'
import type { CrmNewsletterUsageDTO } from '@/src/schemas/crm-newsletter.schema'
import type {
  CrmNewsletterIssueDTO,
  CrmNewsletterIssueRecipientDTO,
  CrmNewsletterIssueStatsDTO,
  CrmNewsletterIssueTrendDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null

export function toCrmNewsletterIssueDTO(
  issue: CrmNewsletterIssue,
  extra: {
    stats?: CrmNewsletterIssueStatsDTO | null
    webUrl?: string | null
    includeDocument?: boolean
  } = {},
): CrmNewsletterIssueDTO {
  return {
    id: issue.id,
    newsletterId: issue.newsletterId,
    number: issue.number,
    subject: issue.subject,
    preheader: issue.preheader,
    slug: issue.slug,
    status: issue.status,
    scheduledAt: iso(issue.scheduledAt),
    sendingStartedAt: iso(issue.sendingStartedAt),
    sentAt: iso(issue.sentAt),
    canceledAt: iso(issue.canceledAt),
    failureReason: issue.failureReason,
    ...(extra.includeDocument
      ? { builderDocument: issue.builderDocument }
      : {}),
    stats: extra.stats ?? null,
    webUrl: extra.webUrl ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  }
}

export function toCrmNewsletterIssueRecipientDTO(
  row: CrmNewsletterIssueRecipient,
): CrmNewsletterIssueRecipientDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    skipReason: row.skipReason,
    error: row.error,
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    openedAt: iso(row.openedAt),
    clickedAt: iso(row.clickedAt),
    bouncedAt: iso(row.bouncedAt),
    complainedAt: iso(row.complainedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
  }
}

/** Share of `part` over the e-mails sent, 0..1 rounded to 4 places. */
export function rate(part: number, sent: number): number | null {
  if (sent <= 0) return null
  return Math.round((part / sent) * 10_000) / 10_000
}

/** Trend rows, oldest first, from issues listed newest first. */
export function toCrmNewsletterIssueTrendDTO(
  issues: CrmNewsletterIssue[],
  stats: Map<string, CrmNewsletterIssueStatsDTO>,
): CrmNewsletterIssueTrendDTO {
  return {
    issues: [...issues].reverse().map((issue) => {
      const s = stats.get(issue.id)
      return {
        id: issue.id,
        number: issue.number,
        subject: issue.subject,
        sentAt: iso(issue.sentAt),
        recipients: s?.recipients ?? 0,
        openRate: s ? rate(s.opened, s.sent) : null,
        clickRate: s ? rate(s.clicked, s.sent) : null,
      }
    }),
  }
}

export function toCrmNewsletterUsageDTO(input: {
  month: string
  usage: CrmNewsletterUsageMonthly | null
  settings: CrmNewsletterSettings | null
  planLimit: number | null
}): CrmNewsletterUsageDTO {
  const override = input.settings?.monthlyEmailLimitOverride ?? null
  return {
    month: input.month,
    emailsSent: input.usage?.emailsSent ?? 0,
    limit: override ?? input.planLimit,
    limitSource: override === null ? 'PLAN' : 'OVERRIDE',
  }
}
