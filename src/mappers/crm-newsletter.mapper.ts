import type { CrmNewsletter, CrmNewsletterSubscriber } from '@prisma/client'
import { newsletterArchiveUrl } from '@/src/lib/newsletter/urls'
import type { CrmNewsletterStats } from '@/src/repositories/crm-newsletter.repository'
import type {
  CrmNewsletterDTO,
  CrmNewsletterSubscriberDTO,
} from '@/src/schemas/crm-newsletter.schema'

const EMPTY_STATS: CrmNewsletterStats = {
  active: 0,
  pending: 0,
  issuesSent: 0,
  lastIssueSentAt: null,
}

const iso = (value: Date | null) => (value ? value.toISOString() : null)

export type CrmNewsletterMapContext = {
  /** App base URL (`BETTER_AUTH_URL`). */
  baseUrl: string
  workspaceSlug: string
  stats?: CrmNewsletterStats
  /** From domain VERIFIED in the workspace right now. */
  senderVerified: boolean
}

export function toCrmNewsletterDTO(
  newsletter: CrmNewsletter,
  context: CrmNewsletterMapContext,
): CrmNewsletterDTO {
  const stats = context.stats ?? EMPTY_STATS
  return {
    id: newsletter.id,
    name: newsletter.name,
    slug: newsletter.slug,
    description: newsletter.description,
    cadenceLabel: newsletter.cadenceLabel,
    fromName: newsletter.fromName,
    fromEmail: newsletter.fromEmail,
    replyTo: newsletter.replyTo,
    sendingDomainId: newsletter.sendingDomainId,
    senderVerified: context.senderVerified,
    templateId: newsletter.templateId,
    doubleOptIn: newsletter.doubleOptIn,
    legalBasis: newsletter.legalBasis,
    archiveEnabled: newsletter.archiveEnabled,
    status: newsletter.status,
    counts: {
      active: stats.active,
      pending: stats.pending,
      issuesSent: stats.issuesSent,
    },
    lastIssueSentAt: iso(stats.lastIssueSentAt),
    archiveUrl:
      newsletter.archiveEnabled && newsletter.status === 'ACTIVE'
        ? newsletterArchiveUrl(
            context.baseUrl,
            context.workspaceSlug,
            newsletter.slug,
          )
        : null,
    createdAt: newsletter.createdAt.toISOString(),
    updatedAt: newsletter.updatedAt.toISOString(),
  }
}

export function toCrmNewsletterSubscriberDTO(
  subscriber: CrmNewsletterSubscriber,
): CrmNewsletterSubscriberDTO {
  return {
    id: subscriber.id,
    email: subscriber.email,
    name: subscriber.name,
    personId: subscriber.personId,
    status: subscriber.status,
    source: subscriber.source,
    consentAt: iso(subscriber.consentAt),
    confirmedAt: iso(subscriber.confirmedAt),
    unsubscribedAt: iso(subscriber.unsubscribedAt),
    unsubscribeReason: subscriber.unsubscribeReason,
    lastSentAt: iso(subscriber.lastSentAt),
    lastOpenedAt: iso(subscriber.lastOpenedAt),
    lastClickedAt: iso(subscriber.lastClickedAt),
    createdAt: subscriber.createdAt.toISOString(),
  }
}
