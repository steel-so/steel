import type { DigestWithSite } from '@/src/repositories/crm-newsletter-digest.repository'
import {
  CRM_NEWSLETTER_DIGEST_OUTCOMES,
  type CrmNewsletterDigestDTO,
  type CrmNewsletterDigestOutcome,
} from '@/src/schemas/crm-newsletter-digest.schema'

const iso = (value: Date | null) => (value ? value.toISOString() : null)

function outcomeOf(value: string | null): CrmNewsletterDigestOutcome | null {
  return (CRM_NEWSLETTER_DIGEST_OUTCOMES as readonly string[]).includes(
    value ?? '',
  )
    ? (value as CrmNewsletterDigestOutcome)
    : null
}

/** Digest settings (nl2-digest-ai); a deleted site shows no name. */
export function toCrmNewsletterDigestDTO(
  digest: DigestWithSite,
): CrmNewsletterDigestDTO {
  const site = digest.site && !digest.site.deletedAt ? digest.site : null
  return {
    id: digest.id,
    newsletterId: digest.newsletterId,
    enabled: digest.enabled,
    siteId: digest.siteId,
    siteName: site?.name ?? null,
    rssUrl: digest.rssUrl,
    cadence: digest.cadence,
    weekday: digest.weekday,
    monthDay: digest.monthDay,
    hour: digest.hour,
    mode: digest.mode,
    maxItems: digest.maxItems,
    subject: digest.subject,
    intro: digest.intro,
    nextRunAt: iso(digest.nextRunAt),
    lastRunAt: iso(digest.lastRunAt),
    lastItemAt: iso(digest.lastItemAt),
    lastIssueId: digest.lastIssueId,
    lastOutcome: outcomeOf(digest.lastOutcome),
    lastMessage: digest.lastMessage,
    updatedAt: digest.updatedAt.toISOString(),
  }
}
