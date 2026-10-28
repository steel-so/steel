import { describe, expect, it } from 'vitest'
import {
  createFakeCrmNewsletter,
  createFakeCrmNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-core.factory'
import {
  toCrmNewsletterDTO,
  toCrmNewsletterSubscriberDTO,
} from '../crm-newsletter.mapper'

const context = {
  baseUrl: 'https://steel.test/',
  workspaceSlug: 'acme',
  senderVerified: true,
}

describe('toCrmNewsletterDTO', () => {
  it('maps counts, last issue and the public archive URL', () => {
    const newsletter = createFakeCrmNewsletter({ slug: 'novidades' })
    const sentAt = new Date('2026-10-01T10:00:00.000Z')
    const dto = toCrmNewsletterDTO(newsletter, {
      ...context,
      stats: { active: 3, pending: 1, issuesSent: 2, lastIssueSentAt: sentAt },
    })

    expect(dto).toMatchObject({
      id: newsletter.id,
      slug: 'novidades',
      senderVerified: true,
      counts: { active: 3, pending: 1, issuesSent: 2 },
      lastIssueSentAt: sentAt.toISOString(),
      archiveUrl: 'https://steel.test/n/acme/novidades',
      createdAt: newsletter.createdAt.toISOString(),
    })
  })

  it('defaults the stats to zero', () => {
    const dto = toCrmNewsletterDTO(createFakeCrmNewsletter(), context)
    expect(dto.counts).toEqual({ active: 0, pending: 0, issuesSent: 0 })
    expect(dto.lastIssueSentAt).toBeNull()
  })

  it.each([[{ archiveEnabled: false }], [{ status: 'ARCHIVED' as const }]])(
    'has no archive URL when %o',
    (overrides) => {
      const dto = toCrmNewsletterDTO(createFakeCrmNewsletter(overrides), {
        ...context,
        senderVerified: false,
      })
      expect(dto.archiveUrl).toBeNull()
      expect(dto.senderVerified).toBe(false)
    },
  )
})

describe('toCrmNewsletterSubscriberDTO', () => {
  it('maps dates to ISO strings and keeps nulls', () => {
    const subscriber = createFakeCrmNewsletterSubscriber({
      lastOpenedAt: new Date('2026-10-02T00:00:00.000Z'),
      consentAt: null,
    })
    const dto = toCrmNewsletterSubscriberDTO(subscriber)
    expect(dto).toEqual({
      id: subscriber.id,
      email: subscriber.email,
      name: null,
      personId: null,
      status: 'ACTIVE',
      source: 'MANUAL',
      consentAt: null,
      confirmedAt: subscriber.confirmedAt?.toISOString(),
      unsubscribedAt: null,
      unsubscribeReason: null,
      lastSentAt: null,
      lastOpenedAt: '2026-10-02T00:00:00.000Z',
      lastClickedAt: null,
      createdAt: subscriber.createdAt.toISOString(),
    })
  })
})
