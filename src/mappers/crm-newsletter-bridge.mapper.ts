import type { PersonSubscriptionRow } from '@/src/repositories/crm-newsletter-bridge.repository'
import type { CrmPersonNewsletterSubscriptionDTO } from '@/src/schemas/crm-newsletter-bridge.schema'

const iso = (value: Date | null) => (value ? value.toISOString() : null)

export function toCrmPersonNewsletterSubscriptionDTO(
  row: PersonSubscriptionRow,
): CrmPersonNewsletterSubscriptionDTO {
  return {
    subscriberId: row.id,
    newsletterId: row.newsletterId,
    newsletterName: row.newsletter.name,
    newsletterArchived: row.newsletter.status === 'ARCHIVED',
    email: row.email,
    status: row.status,
    source: row.source,
    consentAt: iso(row.consentAt),
    confirmedAt: iso(row.confirmedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
    lastOpenedAt: iso(row.lastOpenedAt),
    lastClickedAt: iso(row.lastClickedAt),
    canUnsubscribe: row.status === 'ACTIVE' || row.status === 'PENDING',
  }
}
