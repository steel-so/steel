import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppRecipient } from '@/src/__tests__/factories/newsletter2-engage.factory'
import { toCrmNewsletterWhatsAppRecipientDTO } from '../crm-newsletter-engage.mapper'

describe('toCrmNewsletterWhatsAppRecipientDTO — receipts (nl3)', () => {
  it('exposes the receipt timestamps as ISO strings', () => {
    const dto = toCrmNewsletterWhatsAppRecipientDTO(
      createFakeWhatsAppRecipient({
        status: 'SENT',
        sentAt: new Date('2026-10-29T12:00:00.000Z'),
        deliveredAt: new Date('2026-10-29T12:01:00.000Z'),
        readAt: new Date('2026-10-29T12:30:00.000Z'),
      }),
    )
    expect(dto).toMatchObject({
      deliveredAt: '2026-10-29T12:01:00.000Z',
      readAt: '2026-10-29T12:30:00.000Z',
      failedAt: null,
    })
  })

  it('exposes a provider failure', () => {
    const dto = toCrmNewsletterWhatsAppRecipientDTO(
      createFakeWhatsAppRecipient({
        status: 'FAILED',
        error: '131026: Message undeliverable',
        failedAt: new Date('2026-10-29T12:02:00.000Z'),
      }),
    )
    expect(dto).toMatchObject({
      status: 'FAILED',
      error: '131026: Message undeliverable',
      deliveredAt: null,
      readAt: null,
      failedAt: '2026-10-29T12:02:00.000Z',
    })
  })
})
