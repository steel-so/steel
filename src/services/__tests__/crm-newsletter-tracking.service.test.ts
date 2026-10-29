import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeNewsletterRecipient } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-newsletter-delivery.repository')

import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import type { ResendWebhookEvent } from '@/src/schemas/crm-campaign.schema'
import { CrmNewsletterTrackingService as Service } from '../crm-newsletter-tracking.service'

const repo = vi.mocked(CrmNewsletterDeliveryRepository)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const EARLIER = '2026-10-28T12:59:00.000Z'

const recipient = {
  ...createFakeNewsletterRecipient({ id: 'r1', subscriberId: 's1' }),
  issue: { id: 'is1', workspaceId: 'ws1', newsletterId: 'nl1' },
}

function event(
  type: string,
  data: Record<string, unknown> = {},
  createdAt: string | undefined = EARLIER,
): ResendWebhookEvent {
  return {
    type,
    created_at: createdAt,
    data: { email_id: 'msg-1', ...data },
  }
}

describe('CrmNewsletterTrackingService.onEmailEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findByProviderMessageId.mockResolvedValue(ok(recipient))
    repo.markFirst.mockResolvedValue(ok(true))
    repo.touchSubscriber.mockResolvedValue(ok(undefined))
    repo.recordClick.mockResolvedValue(ok(undefined))
    repo.bounceEverywhere.mockResolvedValue(ok(2))
    repo.complain.mockResolvedValue(ok(undefined))
  })

  it('returns false for messages that are not newsletter e-mails', async () => {
    repo.findByProviderMessageId.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await Service.onEmailEvent(event('email.opened'), NOW)),
    ).toBe(false)
    repo.findByProviderMessageId.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.onEmailEvent(event('email.opened'), NOW))
  })

  it('marks delivery with the event time', async () => {
    expect(
      expectOk(await Service.onEmailEvent(event('email.delivered'), NOW)),
    ).toBe(true)
    expect(repo.markFirst).toHaveBeenCalledWith(
      'r1',
      'deliveredAt',
      new Date(EARLIER),
    )
  })

  it('falls back to now for missing, invalid or future timestamps', async () => {
    await Service.onEmailEvent(
      { type: 'email.delivered', data: { email_id: 'msg-1' } },
      NOW,
    )
    await Service.onEmailEvent(event('email.delivered', {}, 'nope'), NOW)
    await Service.onEmailEvent(
      event('email.delivered', {}, '2030-01-01T00:00:00Z'),
      NOW,
    )
    for (const call of repo.markFirst.mock.calls) expect(call[2]).toEqual(NOW)
  })

  it('marks opens and touches the subscriber', async () => {
    expectOk(await Service.onEmailEvent(event('email.opened'), NOW))
    expect(repo.touchSubscriber).toHaveBeenCalledWith(
      's1',
      'lastOpenedAt',
      new Date(EARLIER),
    )
  })

  it('marks clicks (and the open), stores the URL and touches the subscriber', async () => {
    expectOk(
      await Service.onEmailEvent(
        event('email.clicked', { click: { link: 'https://acme.com/x' } }),
        NOW,
      ),
    )
    expect(repo.markFirst.mock.calls.map((call) => call[1])).toEqual([
      'openedAt',
      'clickedAt',
    ])
    expect(repo.recordClick).toHaveBeenCalledWith({
      issueId: 'is1',
      recipientId: 'r1',
      url: 'https://acme.com/x',
      clickedAt: new Date(EARLIER),
    })
    expect(repo.touchSubscriber).toHaveBeenCalledWith(
      's1',
      'lastClickedAt',
      new Date(EARLIER),
    )

    vi.clearAllMocks()
    expectOk(await Service.onEmailEvent(event('email.clicked'), NOW))
    expect(repo.recordClick).not.toHaveBeenCalled()
  })

  it('disables the address everywhere only on permanent bounces', async () => {
    expectOk(
      await Service.onEmailEvent(
        event('email.bounced', { bounce: { type: 'Permanent' } }),
        NOW,
      ),
    )
    expect(repo.bounceEverywhere).toHaveBeenCalledWith(
      'ws1',
      recipient.email,
      new Date(EARLIER),
    )
    vi.clearAllMocks()
    expectOk(
      await Service.onEmailEvent(
        event('email.bounced', { bounce: { type: 'Transient' } }),
        NOW,
      ),
    )
    expect(repo.markFirst).toHaveBeenCalledWith(
      'r1',
      'bouncedAt',
      new Date(EARLIER),
    )
    expect(repo.bounceEverywhere).not.toHaveBeenCalled()
  })

  it('takes complaints out of that newsletter', async () => {
    expectOk(await Service.onEmailEvent(event('email.complained'), NOW))
    expect(repo.complain).toHaveBeenCalledWith('s1', new Date(EARLIER))
  })

  it('ignores other event types but claims the message', async () => {
    expect(expectOk(await Service.onEmailEvent(event('email.sent'), NOW))).toBe(
      true,
    )
    expect(repo.markFirst).not.toHaveBeenCalled()
  })

  it('propagates every write failure', async () => {
    const fail = err(databaseError())
    const cases: Array<[string, Record<string, unknown>, () => void]> = [
      ['email.delivered', {}, () => repo.markFirst.mockResolvedValueOnce(fail)],
      ['email.opened', {}, () => repo.markFirst.mockResolvedValueOnce(fail)],
      [
        'email.opened',
        {},
        () => repo.touchSubscriber.mockResolvedValueOnce(fail),
      ],
      ['email.clicked', {}, () => repo.markFirst.mockResolvedValueOnce(fail)],
      [
        'email.clicked',
        {},
        () =>
          repo.markFirst
            .mockResolvedValueOnce(ok(true))
            .mockResolvedValueOnce(fail),
      ],
      [
        'email.clicked',
        { click: { link: 'https://a' } },
        () => repo.recordClick.mockResolvedValueOnce(fail),
      ],
      [
        'email.clicked',
        {},
        () => repo.touchSubscriber.mockResolvedValueOnce(fail),
      ],
      ['email.bounced', {}, () => repo.markFirst.mockResolvedValueOnce(fail)],
      [
        'email.bounced',
        {},
        () => repo.bounceEverywhere.mockResolvedValueOnce(fail),
      ],
      [
        'email.complained',
        {},
        () => repo.markFirst.mockResolvedValueOnce(fail),
      ],
      ['email.complained', {}, () => repo.complain.mockResolvedValueOnce(fail)],
    ]
    for (const [type, data, arrange] of cases) {
      arrange()
      expectErr(await Service.onEmailEvent(event(type, data), NOW))
    }
  })
})
