import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeNewsletter } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { createFakeWelcomeStep } from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueIncomplete,
  databaseError,
  sendingDomainNotVerified,
} from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'
import type { ClaimedWelcomeDelivery } from '@/src/repositories/crm-newsletter-welcome.repository'

vi.mock('@/src/repositories/crm-newsletter-welcome.repository')
vi.mock('@/src/repositories/crm-newsletter-delivery.repository', () => ({
  CrmNewsletterDeliveryRepository: { optedOut: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-render', () => ({
  renderIssueBase: vi.fn(),
  loadRecipientFacts: vi.fn(),
  personalizeIssue: vi.fn(() => ({
    subject: 'S',
    html: '<p>h</p>',
    text: 'texto',
  })),
}))
vi.mock('@/src/services/crm-newsletter-usage.service', () => ({
  CrmNewsletterUsageService: {
    getUsage: vi.fn(),
    record: vi.fn(),
    remaining: (usage: { limit: number | null; emailsSent: number }) =>
      usage.limit === null ? null : Math.max(0, usage.limit - usage.emailsSent),
  },
}))
vi.mock('@/src/lib/sending-domain/resolve-sender', () => ({
  resolveVerifiedSender: vi.fn(),
}))
vi.mock('@/src/lib/mail/send-batch', () => ({ sendEmailBatch: vi.fn() }))

import { sendEmailBatch } from '@/src/lib/mail/send-batch'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterWelcomeRepository } from '@/src/repositories/crm-newsletter-welcome.repository'
import {
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
} from '../crm-newsletter-render'
import { CrmNewsletterUsageService } from '../crm-newsletter-usage.service'
import {
  CrmNewsletterWelcomeSendService as Service,
  WELCOME_TICK_LIMIT,
} from '../crm-newsletter-welcome-send.service'

const repo = vi.mocked(CrmNewsletterWelcomeRepository)
const optedOut = vi.mocked(CrmNewsletterDeliveryRepository.optedOut)
const usage = vi.mocked(CrmNewsletterUsageService)
const sender = vi.mocked(resolveVerifiedSender)
const batch = vi.mocked(sendEmailBatch)
const render = vi.mocked(renderIssueBase)
const facts = vi.mocked(loadRecipientFacts)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const newsletter = createFakeNewsletter({ replyTo: 'reply@acme.com.br' })
const base = {
  email: { subject: 'S', html: '<p>x</p>', text: 'x' },
  brand: {
    companyName: 'Acme',
    logoUrl: '',
    primaryColor: '#000000',
    address: '',
    website: '',
  },
  doc: createBlankEmailDocument(),
}

function rows(
  count: number,
  over: Partial<ClaimedWelcomeDelivery> = {},
): ClaimedWelcomeDelivery[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `d${index}`,
    stepId: 'st1',
    subscriberId: `s${index}`,
    email: `p${index}@acme.com.br`,
    name: index === 0 ? null : `P${index}`,
    personId: index === 1 ? 'person1' : null,
    subscriberStatus: 'ACTIVE',
    ...over,
  }))
}

function usageOf(limit: number | null, emailsSent = 0) {
  return ok({
    month: '2026-10',
    emailsSent,
    limit,
    planLimit: limit,
    override: null,
  }) as never
}

describe('CrmNewsletterWelcomeSendService.processNewsletter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sender.mockResolvedValue(ok({ sendingDomainId: 'd1' }))
    usage.getUsage.mockResolvedValue(usageOf(null))
    usage.record.mockResolvedValue(usageOf(null))
    optedOut.mockResolvedValue(ok(new Set()))
    repo.findStepsByIds.mockResolvedValue(ok([createFakeWelcomeStep()]))
    repo.markSkipped.mockResolvedValue(ok(undefined))
    repo.markSent.mockResolvedValue(ok(undefined))
    repo.markFailed.mockResolvedValue(ok(undefined))
    repo.release.mockResolvedValue(ok(undefined))
    render.mockResolvedValue(ok(base))
    facts.mockResolvedValue(
      ok({
        people: new Map([['person1', { email: 'x', name: 'Pessoa' }]]),
        lists: new Map(),
      }),
    )
    batch.mockImplementation(async (emails) =>
      emails.map((_, index) => `msg-${index}`),
    )
  })

  it('sends the due rows like an issue and records usage', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(3)))
    const outcome = expectOk(await Service.processNewsletter(newsletter, NOW))
    // The canvas footer names the newsletter the reader subscribed to.
    expect(render).toHaveBeenCalledWith(
      newsletter.workspaceId,
      expect.anything(),
      expect.any(String),
      newsletter.name,
    )
    expect(outcome).toEqual({
      status: 'sent',
      sent: 3,
      skipped: 0,
      failed: 0,
      deferred: 0,
    })
    expect(repo.claimDue).toHaveBeenCalledWith(
      'nl1',
      NOW,
      new Date(NOW.getTime() - 15 * 60 * 1000),
      WELCOME_TICK_LIMIT,
    )
    const [emails, options] = batch.mock.calls[0]
    expect(emails[0]).toMatchObject({
      from: '"Acme" <news@news.acme.com.br>',
      to: 'p0@acme.com.br',
      replyTo: 'reply@acme.com.br',
      tags: [
        { name: 'kind', value: 'newsletter' },
        { name: 'welcome', value: 'st1' },
      ],
    })
    expect(emails[0].headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    expect(options).toEqual({ idempotencyKey: 'crm-newsletter-welcome-d0-3' })
    // CRM person data feeds the personalization.
    expect(vi.mocked(personalizeIssue).mock.calls[1][1].contact.name).toBe('P1')
    expect(repo.markSent).toHaveBeenCalledWith(
      [
        { id: 'd0', subscriberId: 's0', providerMessageId: 'msg-0' },
        { id: 'd1', subscriberId: 's1', providerMessageId: 'msg-1' },
        { id: 'd2', subscriberId: 's2', providerMessageId: 'msg-2' },
      ],
      NOW,
    )
    expect(usage.record).toHaveBeenCalledWith('ws1', 3, NOW)
  })

  it('omits Reply-To when the newsletter has none and uses the person name', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(2, { name: null })))
    expectOk(await Service.processNewsletter(createFakeNewsletter(), NOW))
    expect(batch.mock.calls[0][0][0]).not.toHaveProperty('replyTo')
    expect(vi.mocked(personalizeIssue).mock.calls[1][1].contact.name).toBe(
      'Pessoa',
    )
  })

  it('claims nothing without a verified sender or quota', async () => {
    sender.mockResolvedValue(err(sendingDomainNotVerified('x')))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)).status,
    ).toBe('sender_not_verified')
    sender.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )

    sender.mockResolvedValue(ok({ sendingDomainId: 'd1' }))
    usage.getUsage.mockResolvedValue(usageOf(100, 100))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)).status,
    ).toBe('limit_reached')
    usage.getUsage.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
    expect(repo.claimDue).not.toHaveBeenCalled()
  })

  it('claims at most the remaining quota and reports idle', async () => {
    usage.getUsage.mockResolvedValue(usageOf(100, 90))
    repo.claimDue.mockResolvedValue(ok([]))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)).status,
    ).toBe('idle')
    expect(repo.claimDue.mock.calls[0][3]).toBe(10)
    repo.claimDue.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('skips opted-out, left and disabled-step rows', async () => {
    repo.claimDue.mockResolvedValue(
      ok([
        ...rows(1),
        ...rows(1, { id: 'out', email: 'OUT@acme.com.br' }),
        ...rows(1, { id: 'bounced', subscriberStatus: 'BOUNCED' }),
        ...rows(1, { id: 'spam', subscriberStatus: 'COMPLAINED' }),
        ...rows(1, { id: 'left', subscriberStatus: 'UNSUBSCRIBED' }),
        ...rows(1, { id: 'off', stepId: 'st-off' }),
        ...rows(1, { id: 'gone', stepId: 'st-gone' }),
      ]),
    )
    optedOut.mockResolvedValue(ok(new Set(['out@acme.com.br'])))
    repo.findStepsByIds.mockResolvedValue(
      ok([
        createFakeWelcomeStep(),
        createFakeWelcomeStep({ id: 'st-off', enabled: false }),
      ]),
    )
    const outcome = expectOk(await Service.processNewsletter(newsletter, NOW))
    expect(outcome).toMatchObject({ sent: 1, skipped: 6 })
    const reasons = Object.fromEntries(
      repo.markSkipped.mock.calls.map(([ids, reason]) => [reason, ids]),
    )
    expect(reasons).toEqual({
      OPTED_OUT: ['out'],
      BOUNCED: ['bounced'],
      COMPLAINED: ['spam'],
      UNSUBSCRIBED: ['left'],
      STEP_DISABLED: ['off', 'gone'],
    })
  })

  it('gives rows back when lookups fail', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(2)))
    optedOut.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
    expect(repo.release).toHaveBeenCalledWith(['d0', 'd1'])

    optedOut.mockResolvedValue(ok(new Set()))
    repo.findStepsByIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )

    repo.findStepsByIds.mockResolvedValue(ok([createFakeWelcomeStep()]))
    repo.markSkipped.mockResolvedValue(err(databaseError()))
    repo.claimDue.mockResolvedValue(
      ok(rows(1, { subscriberStatus: 'BOUNCED' })),
    )
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('fails the rows of a step whose content is broken', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(2)))
    render.mockResolvedValue(err(crmNewsletterIssueIncomplete('Sem rodapé')))
    const outcome = expectOk(await Service.processNewsletter(newsletter, NOW))
    expect(outcome).toMatchObject({ sent: 0, failed: 2 })
    expect(repo.markFailed).toHaveBeenCalledWith(['d0', 'd1'], 'Sem rodapé')

    repo.markFailed.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )

    render.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
    expect(repo.release).toHaveBeenCalledWith(['d0', 'd1'])

    render.mockResolvedValue(ok(base))
    facts.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('defers transient provider errors and fails permanent ones', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(2)))
    batch.mockRejectedValueOnce(new Error('429 rate limit'))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)),
    ).toMatchObject({ deferred: 2, sent: 0 })
    expect(repo.release).toHaveBeenCalledWith(['d0', 'd1'])

    batch.mockRejectedValueOnce(new Error('Invalid from'))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)),
    ).toMatchObject({ failed: 2 })
    expect(repo.markFailed).toHaveBeenCalledWith(['d0', 'd1'], 'Invalid from')

    batch.mockRejectedValueOnce('boom')
    expectOk(await Service.processNewsletter(newsletter, NOW))
    expect(repo.markFailed).toHaveBeenLastCalledWith(
      ['d0', 'd1'],
      'Falha ao enviar o lote',
    )

    repo.markFailed.mockResolvedValue(err(databaseError()))
    batch.mockRejectedValueOnce(new Error('Invalid from'))
    expectErr(
      await Service.processNewsletter(newsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('never fails after sending when bookkeeping breaks', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(1)))
    repo.markSent.mockResolvedValue(err(databaseError()))
    usage.record.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)).sent,
    ).toBe(1)
  })

  it('sends more than one Resend batch per step', async () => {
    repo.claimDue.mockResolvedValue(ok(rows(150)))
    expect(
      expectOk(await Service.processNewsletter(newsletter, NOW)).sent,
    ).toBe(150)
    expect(batch).toHaveBeenCalledTimes(2)
    expect(batch.mock.calls[1][1]).toEqual({
      idempotencyKey: 'crm-newsletter-welcome-d100-50',
    })
  })
})

describe('CrmNewsletterWelcomeSendService.tick', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes every newsletter and isolates failures', async () => {
    repo.listNewslettersWithSeries.mockResolvedValue(
      ok([newsletter, createFakeNewsletter({ id: 'nl2' })]),
    )
    const spy = vi
      .spyOn(Service, 'processNewsletter')
      .mockResolvedValueOnce(
        ok({ status: 'sent', sent: 2, skipped: 1, failed: 1, deferred: 3 }),
      )
      .mockResolvedValueOnce(err(databaseError()))
    expect(expectOk(await Service.tick(NOW))).toEqual({
      newsletters: 2,
      errors: 1,
      sent: 2,
      skipped: 1,
      failed: 1,
      deferred: 3,
    })
    spy.mockRestore()

    repo.listNewslettersWithSeries.mockResolvedValue(err(databaseError()))
    expectErr(await Service.tick(NOW), 'DATABASE_ERROR')
  })
})
