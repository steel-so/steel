import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeReengagement,
  createFakeWelcomeDelivery,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-newsletter-welcome.repository', () => ({
  CrmNewsletterWelcomeRepository: {
    findByProviderMessageId: vi.fn(),
    markFirst: vi.fn(),
  },
}))
vi.mock('@/src/repositories/crm-newsletter-reengagement.repository', () => ({
  CrmNewsletterReengagementRepository: {
    findByProviderMessageId: vi.fn(),
    markFirst: vi.fn(),
  },
}))
vi.mock('@/src/repositories/crm-newsletter-delivery.repository', () => ({
  CrmNewsletterDeliveryRepository: {
    touchSubscriber: vi.fn(),
    bounceEverywhere: vi.fn(),
    complain: vi.fn(),
  },
}))

import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterReengagementRepository } from '@/src/repositories/crm-newsletter-reengagement.repository'
import { CrmNewsletterWelcomeRepository } from '@/src/repositories/crm-newsletter-welcome.repository'
import { CrmNewsletterAutomationTrackingService as Service } from '../crm-newsletter-automation-tracking.service'

const welcome = vi.mocked(CrmNewsletterWelcomeRepository)
const reengagement = vi.mocked(CrmNewsletterReengagementRepository)
const deliveries = vi.mocked(CrmNewsletterDeliveryRepository)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const EARLIER = new Date('2026-10-28T12:00:00.000Z')

function event(type: string, data: Record<string, unknown> = {}, at?: string) {
  return {
    type,
    ...(at ? { created_at: at } : {}),
    data: { email_id: 'msg-1', ...data },
  }
}

describe('CrmNewsletterAutomationTrackingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    welcome.findByProviderMessageId.mockResolvedValue(ok(null))
    reengagement.findByProviderMessageId.mockResolvedValue(ok(null))
    welcome.markFirst.mockResolvedValue(ok(true))
    reengagement.markFirst.mockResolvedValue(ok(true))
    deliveries.touchSubscriber.mockResolvedValue(ok(undefined))
    deliveries.bounceEverywhere.mockResolvedValue(ok(2))
    deliveries.complain.mockResolvedValue(ok(undefined))
  })

  it('returns false for messages that are not automation e-mails', async () => {
    expect(
      expectOk(await Service.onEmailEvent(event('email.opened'), NOW)),
    ).toBe(false)
  })

  describe('welcome e-mails', () => {
    beforeEach(() => {
      welcome.findByProviderMessageId.mockResolvedValue(
        ok(createFakeWelcomeDelivery()),
      )
    })

    it('marks delivered, opened and clicked (with the event time)', async () => {
      expect(
        expectOk(
          await Service.onEmailEvent(
            event('email.delivered', {}, EARLIER.toISOString()),
            NOW,
          ),
        ),
      ).toBe(true)
      expect(welcome.markFirst).toHaveBeenCalledWith(
        'wd1',
        'deliveredAt',
        EARLIER,
      )
      expect(deliveries.touchSubscriber).not.toHaveBeenCalled()

      await Service.onEmailEvent(event('email.opened'), NOW)
      expect(welcome.markFirst).toHaveBeenLastCalledWith('wd1', 'openedAt', NOW)
      expect(deliveries.touchSubscriber).toHaveBeenLastCalledWith(
        's1',
        'lastOpenedAt',
        NOW,
      )

      await Service.onEmailEvent(
        event('email.clicked', {}, '2099-01-01T00:00:00Z'),
        NOW,
      )
      expect(welcome.markFirst).toHaveBeenCalledWith('wd1', 'clickedAt', NOW)
      expect(deliveries.touchSubscriber).toHaveBeenLastCalledWith(
        's1',
        'lastClickedAt',
        NOW,
      )

      await Service.onEmailEvent(event('email.sent', {}, 'not a date'), NOW)
    })

    it('handles bounces and complaints like an issue', async () => {
      await Service.onEmailEvent(
        event('email.bounced', { bounce: { type: 'Transient' } }),
        NOW,
      )
      expect(welcome.markFirst).toHaveBeenLastCalledWith(
        'wd1',
        'bouncedAt',
        NOW,
      )
      expect(deliveries.bounceEverywhere).not.toHaveBeenCalled()
      await Service.onEmailEvent(event('email.bounced'), NOW)
      expect(deliveries.bounceEverywhere).toHaveBeenCalledWith(
        'ws1',
        'ana@example.com',
        NOW,
      )
      await Service.onEmailEvent(event('email.complained'), NOW)
      expect(deliveries.complain).toHaveBeenCalledWith('s1', NOW)
    })

    it('propagates DB errors', async () => {
      deliveries.complain.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.complained'), NOW),
        'DATABASE_ERROR',
      )
      deliveries.bounceEverywhere.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.bounced'), NOW),
        'DATABASE_ERROR',
      )
      deliveries.touchSubscriber
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.clicked'), NOW),
        'DATABASE_ERROR',
      )
      deliveries.touchSubscriber.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.clicked'), NOW),
        'DATABASE_ERROR',
      )
      welcome.markFirst.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.opened'), NOW),
        'DATABASE_ERROR',
      )
      welcome.findByProviderMessageId.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.opened'), NOW),
        'DATABASE_ERROR',
      )
    })
  })

  describe('re-engagement e-mails', () => {
    beforeEach(() => {
      reengagement.findByProviderMessageId.mockResolvedValue(
        ok(createFakeReengagement()),
      )
    })

    it('records opens and clicks and refreshes engagement', async () => {
      expect(
        expectOk(await Service.onEmailEvent(event('email.opened'), NOW)),
      ).toBe(true)
      expect(reengagement.markFirst).toHaveBeenCalledWith(
        're1',
        'openedAt',
        NOW,
      )
      expect(deliveries.touchSubscriber).toHaveBeenCalledWith(
        's1',
        'lastOpenedAt',
        NOW,
      )
      await Service.onEmailEvent(event('email.clicked'), NOW)
      expect(reengagement.markFirst).toHaveBeenLastCalledWith(
        're1',
        'clickedAt',
        NOW,
      )
      vi.mocked(reengagement.markFirst).mockClear()
      await Service.onEmailEvent(event('email.delivered'), NOW)
      expect(reengagement.markFirst).not.toHaveBeenCalled()
    })

    it('propagates DB errors', async () => {
      reengagement.markFirst
        .mockResolvedValueOnce(ok(true))
        .mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.clicked'), NOW),
        'DATABASE_ERROR',
      )
      reengagement.markFirst.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.opened'), NOW),
        'DATABASE_ERROR',
      )
      reengagement.markFirst.mockResolvedValue(ok(true))
      deliveries.touchSubscriber.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.onEmailEvent(event('email.opened'), NOW),
        'DATABASE_ERROR',
      )
      reengagement.findByProviderMessageId.mockResolvedValue(
        err(databaseError()),
      )
      expectErr(
        await Service.onEmailEvent(event('email.opened'), NOW),
        'DATABASE_ERROR',
      )
    })
  })
})
