import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeNewsletter } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  createFakeReengagement,
  createFakeReengagementSettings,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  sendingDomainNotVerified,
} from '@/src/errors'
import { createReengageToken } from '@/src/lib/newsletter/reengage-token'
import { err, ok } from '@/src/lib/result'
import type {
  DueReengagement,
  ReengagementWithContext,
} from '@/src/repositories/crm-newsletter-reengagement.repository'
import { CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS } from '@/src/schemas/crm-newsletter-automation.schema'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
}))
vi.mock('@/src/repositories/crm-newsletter-reengagement.repository')
vi.mock('@/src/repositories/crm-newsletter-issue.repository', () => ({
  CrmNewsletterIssueRepository: { findNewsletter: vi.fn() },
}))
vi.mock('@/src/repositories/crm-email-builder.repository', () => ({
  CrmEmailBuilderRepository: {
    findBrand: vi.fn(),
    findWorkspaceIdentity: vi.fn(),
  },
}))
vi.mock('@/src/services/crm-newsletter-usage.service', () => ({
  newsletterUsageMonth: () => '2026-10',
  CrmNewsletterUsageService: {
    getUsage: vi.fn(),
    record: vi.fn(),
    remaining: (usage: { limit: number | null; emailsSent: number }) =>
      usage.limit === null ? null : Math.max(0, usage.limit - usage.emailsSent),
  },
}))
vi.mock('@/src/services/crm-newsletter-automation-notifications', () => ({
  notifyNewsletterReengagementSummary: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/sending-domain/resolve-sender', () => ({
  resolveVerifiedSender: vi.fn(),
}))
vi.mock('@/src/lib/mail/send-batch', () => ({ sendEmailBatch: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { sendEmailBatch } from '@/src/lib/mail/send-batch'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterReengagementRepository } from '@/src/repositories/crm-newsletter-reengagement.repository'
import { notifyNewsletterReengagementSummary } from '../crm-newsletter-automation-notifications'
import { loadNewsletterScope } from '../crm-newsletter-issue.service'
import {
  engagedSince,
  CrmNewsletterReengagementService as Service,
} from '../crm-newsletter-reengagement.service'
import { CrmNewsletterUsageService } from '../crm-newsletter-usage.service'

const repo = vi.mocked(CrmNewsletterReengagementRepository)
const scope = vi.mocked(loadNewsletterScope)
const usage = vi.mocked(CrmNewsletterUsageService)
const sender = vi.mocked(resolveVerifiedSender)
const batch = vi.mocked(sendEmailBatch)
const brand = vi.mocked(CrmEmailBuilderRepository)
const notify = vi.mocked(notifyNewsletterReengagementSummary)
const issues = vi.mocked(CrmNewsletterIssueRepository)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const A = ['u1', 'ws1', 'nl1'] as const
const preview = { waiting: 2, dueNow: 1 }
const totals = { sent: 5, reengaged: 1, unsubscribed: 2, flagged: 0 }
const settingsWithNewsletter = {
  ...createFakeReengagementSettings(),
  newsletter: createFakeNewsletter({ replyTo: 'r@acme.com.br' }),
}

function usageOf(limit: number | null, emailsSent = 0) {
  return ok({ month: '2026-10', emailsSent, limit }) as never
}

function due(over: Partial<DueReengagement> = {}): DueReengagement {
  return {
    id: 're1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    sentAt: new Date(NOW.getTime() - 40 * DAY),
    openedAt: null,
    clickedAt: null,
    reengagedAt: null,
    subscriberStatus: 'ACTIVE',
    lastOpenedAt: null,
    lastClickedAt: null,
    action: 'UNSUBSCRIBE',
    ...over,
  }
}

function context(
  over: Partial<ReengagementWithContext> = {},
): ReengagementWithContext {
  return {
    ...createFakeReengagement(),
    newsletter: { id: 'nl1', name: 'Novidades', workspace: { name: 'Acme' } },
    subscriber: { id: 's1', status: 'ACTIVE', unsubscribeReason: null },
    ...over,
  }
}

describe('engagedSince', () => {
  it('counts the button, opens, clicks and later activity', () => {
    const sentAt = new Date(NOW.getTime() - 40 * DAY)
    const after = new Date(sentAt.getTime() + DAY)
    const before = new Date(sentAt.getTime() - DAY)
    expect(engagedSince(due())).toBe(false)
    expect(engagedSince(due({ reengagedAt: after }))).toBe(true)
    expect(engagedSince(due({ openedAt: after }))).toBe(true)
    expect(engagedSince(due({ clickedAt: after }))).toBe(true)
    expect(engagedSince(due({ lastOpenedAt: after }))).toBe(true)
    expect(engagedSince(due({ lastClickedAt: after }))).toBe(true)
    expect(
      engagedSince(due({ lastOpenedAt: before, lastClickedAt: before })),
    ).toBe(false)
  })
})

describe('CrmNewsletterReengagementService — member side', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scope.mockResolvedValue(ok({}) as never)
    repo.findSettings.mockResolvedValue(ok(null))
    repo.countCandidates.mockResolvedValue(ok(7))
    repo.countWaiting.mockResolvedValue(ok(preview))
    repo.totals.mockResolvedValue(ok(totals))
  })

  it('returns the defaults (off) with the preview and totals', async () => {
    const dto = expectOk(await Service.get(...A, NOW))
    expect(dto).toMatchObject({
      saved: false,
      enabled: false,
      preview: { candidates: 7, waiting: 2, dueNow: 1 },
      totals,
    })
    expect(repo.countCandidates).toHaveBeenCalledWith({
      newsletterId: 'nl1',
      minIssues: 3,
      inactiveDays: 90,
      now: NOW,
    })
    expect(repo.countWaiting).toHaveBeenCalledWith('nl1', NOW, 30)
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'VIEW')
  })

  it('uses the saved settings', async () => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeReengagementSettings({ minIssues: 5, graceDays: 14 })),
    )
    expect(expectOk(await Service.get(...A, NOW)).saved).toBe(true)
    expect(repo.countCandidates.mock.calls[0][0].minIssues).toBe(5)
    expect(repo.countWaiting).toHaveBeenCalledWith('nl1', NOW, 14)
  })

  it('propagates scope and DB errors', async () => {
    repo.totals.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, NOW), 'DATABASE_ERROR')
    repo.countWaiting.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, NOW), 'DATABASE_ERROR')
    repo.countCandidates.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, NOW), 'DATABASE_ERROR')
    repo.findSettings.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, NOW), 'DATABASE_ERROR')
    expectErr(await Service.preview(...A, {}, NOW), 'DATABASE_ERROR')
    scope.mockResolvedValue(err(forbidden()))
    expectErr(await Service.get(...A, NOW), 'FORBIDDEN')
    expectErr(await Service.preview(...A, {}, NOW), 'FORBIDDEN')
    expectErr(
      await Service.update(
        ...A,
        { ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS },
        NOW,
      ),
      'FORBIDDEN',
    )
  })

  it('previews unsaved values (falling back to the saved ones)', async () => {
    expect(
      expectOk(await Service.preview(...A, { minIssues: 2 }, NOW)),
    ).toEqual({ candidates: 7, ...preview })
    expect(repo.countCandidates.mock.calls[0][0]).toMatchObject({
      minIssues: 2,
      inactiveDays: 90,
    })
    repo.findSettings.mockResolvedValue(
      ok(createFakeReengagementSettings({ minIssues: 4 })),
    )
    expectOk(await Service.preview(...A, { inactiveDays: 60 }, NOW))
    expect(repo.countCandidates.mock.calls[1][0]).toMatchObject({
      minIssues: 4,
      inactiveDays: 60,
    })
  })

  it('saves with EDIT and audits', async () => {
    repo.upsertSettings.mockResolvedValue(ok(createFakeReengagementSettings()))
    const dto = { ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS, enabled: true }
    expectOk(await Service.update(...A, dto, NOW))
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'EDIT')
    expect(repo.upsertSettings).toHaveBeenCalledWith('nl1', 'ws1', {
      ...dto,
      updatedById: 'u1',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter',
        meta: expect.objectContaining({
          reengagement: expect.objectContaining({ enabled: true }),
        }),
      }),
    )
    repo.upsertSettings.mockResolvedValue(err(databaseError()))
    expectErr(await Service.update(...A, dto, NOW), 'DATABASE_ERROR')
  })
})

describe('CrmNewsletterReengagementService — monthly run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sender.mockResolvedValue(ok({ sendingDomainId: 'd1' }))
    usage.getUsage.mockResolvedValue(usageOf(null))
    usage.record.mockResolvedValue(usageOf(null))
    brand.findBrand.mockResolvedValue(ok(null))
    brand.findWorkspaceIdentity.mockResolvedValue(
      ok({ name: 'Acme', logoUrl: null }),
    )
    repo.markSent.mockResolvedValue(ok(undefined))
    repo.markFailed.mockResolvedValue(ok(undefined))
    batch.mockImplementation(async (emails) =>
      emails.map((_, index) => `msg-${index}`),
    )
  })

  const claimed = (count: number) =>
    ok(
      Array.from({ length: count }, (_, index) => ({
        id: `re${index}`,
        subscriberId: `s${index}`,
        email: `p${index}@acme.com.br`,
        name: null,
        personId: null,
      })),
    )

  it('sends the re-engagement e-mail and tells the creator', async () => {
    repo.claimCandidates.mockResolvedValue(claimed(2))
    const outcome = expectOk(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
    )
    expect(outcome).toEqual({ status: 'sent', sent: 2, failed: 0 })
    expect(repo.claimCandidates).toHaveBeenCalledWith({
      newsletterId: 'nl1',
      minIssues: 3,
      inactiveDays: 90,
      now: NOW,
      cycle: '2026-10',
      limit: 20_000,
    })
    const [emails, options] = batch.mock.calls[0]
    expect(emails[0]).toMatchObject({
      from: '"Acme" <news@news.acme.com.br>',
      to: 'p0@acme.com.br',
      subject: CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS.subject,
      replyTo: 'r@acme.com.br',
      tags: [
        { name: 'kind', value: 'newsletter' },
        { name: 'reengagement', value: 'nl1' },
      ],
    })
    expect(emails[0].html).toContain(
      `/newsletter/continuar/${createReengageToken('re0')}`,
    )
    expect(options).toEqual({
      idempotencyKey: 'crm-newsletter-reengagement-re0-2',
    })
    expect(repo.markSent).toHaveBeenCalledWith(
      [
        { id: 're0', subscriberId: 's0', providerMessageId: 'msg-0' },
        { id: 're1', subscriberId: 's1', providerMessageId: 'msg-1' },
      ],
      NOW,
    )
    expect(usage.record).toHaveBeenCalledWith('ws1', 2, NOW)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'sent', sent: 2, runKey: '2026-10' }),
    )
  })

  it('skips without sender or quota and caps at the remaining quota', async () => {
    sender.mockResolvedValue(err(sendingDomainNotVerified('x')))
    expect(
      expectOk(await Service.sendForNewsletter(settingsWithNewsletter, NOW))
        .status,
    ).toBe('sender_not_verified')
    sender.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
    sender.mockResolvedValue(ok({ sendingDomainId: 'd1' }))
    usage.getUsage.mockResolvedValue(usageOf(10, 10))
    expect(
      expectOk(await Service.sendForNewsletter(settingsWithNewsletter, NOW))
        .status,
    ).toBe('limit_reached')
    usage.getUsage.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
    usage.getUsage.mockResolvedValue(usageOf(10, 4))
    repo.claimCandidates.mockResolvedValue(ok([]))
    expect(
      expectOk(await Service.sendForNewsletter(settingsWithNewsletter, NOW))
        .status,
    ).toBe('idle')
    expect(repo.claimCandidates.mock.calls[0][0].limit).toBe(6)
    expect(notify).not.toHaveBeenCalled()
    repo.claimCandidates.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('fails the attempts when the brand cannot load', async () => {
    repo.claimCandidates.mockResolvedValue(claimed(1))
    brand.findBrand.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
    expect(repo.markFailed).toHaveBeenCalledWith(
      ['re0'],
      'Falha ao carregar a marca',
    )
    brand.findBrand.mockResolvedValue(ok(null))
    brand.findWorkspaceIdentity.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('marks a refused batch as failed (no retry within the month)', async () => {
    repo.claimCandidates.mockResolvedValue(claimed(1))
    batch.mockRejectedValueOnce(new Error('429 rate limit'))
    expect(
      expectOk(await Service.sendForNewsletter(settingsWithNewsletter, NOW)),
    ).toEqual({ status: 'sent', sent: 0, failed: 1 })
    expect(repo.markFailed).toHaveBeenCalledWith(['re0'], '429 rate limit')
    expect(notify).not.toHaveBeenCalled()

    batch.mockRejectedValueOnce('boom')
    repo.markFailed.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.sendForNewsletter(settingsWithNewsletter, NOW),
      'DATABASE_ERROR',
    )
  })

  it('never fails after sending when bookkeeping breaks', async () => {
    repo.claimCandidates.mockResolvedValue(claimed(1))
    repo.markSent.mockResolvedValue(err(databaseError()))
    usage.record.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await Service.sendForNewsletter(
          {
            ...settingsWithNewsletter,
            newsletter: createFakeNewsletter(),
          },
          NOW,
        ),
      ).sent,
    ).toBe(1)
    expect(batch.mock.calls[0][0][0]).not.toHaveProperty('replyTo')
  })

  it('runs every enabled newsletter after closing stuck attempts', async () => {
    repo.failStuck.mockResolvedValue(ok(0))
    repo.listEnabled.mockResolvedValue(
      ok([settingsWithNewsletter, settingsWithNewsletter]),
    )
    const spy = vi
      .spyOn(Service, 'sendForNewsletter')
      .mockResolvedValueOnce(ok({ status: 'sent', sent: 3, failed: 0 }))
      .mockResolvedValueOnce(err(databaseError()))
    expect(expectOk(await Service.runMonthly(NOW))).toEqual({
      newsletters: 2,
      sent: 3,
      errors: 1,
    })
    expect(repo.failStuck).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 60 * 60 * 1000),
    )
    spy.mockRestore()

    repo.listEnabled.mockResolvedValue(err(databaseError()))
    expectErr(await Service.runMonthly(NOW), 'DATABASE_ERROR')
    repo.failStuck.mockResolvedValue(err(databaseError()))
    expectErr(await Service.runMonthly(NOW), 'DATABASE_ERROR')
  })
})

describe('CrmNewsletterReengagementService — end of the grace period', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.unsubscribeInactive.mockResolvedValue(ok(1))
    repo.resolve.mockImplementation(async (ids) => ok(ids.length))
    issues.findNewsletter.mockResolvedValue(ok(createFakeNewsletter()))
  })

  it('reengages, unsubscribes, flags and skips, then notifies', async () => {
    const after = new Date(NOW.getTime() - 30 * DAY)
    repo.listDue.mockResolvedValueOnce(
      ok([
        due({ id: 'a', openedAt: after }),
        due({ id: 'b', subscriberId: 's-b' }),
        due({ id: 'c', action: 'FLAG' }),
        due({ id: 'd', subscriberStatus: 'BOUNCED' }),
        due({ id: 'e', newsletterId: 'nl2', workspaceId: 'ws2' }),
      ]),
    )
    const outcome = expectOk(await Service.resolveDue(NOW))
    expect(outcome).toEqual({
      reengaged: 1,
      unsubscribed: 2,
      flagged: 1,
      skipped: 1,
    })
    expect(repo.unsubscribeInactive).toHaveBeenCalledWith(['s-b', 's1'], NOW)
    expect(repo.resolve).toHaveBeenCalledWith(['a'], 'REENGAGED', NOW)
    expect(repo.resolve).toHaveBeenCalledWith(['b', 'e'], 'UNSUBSCRIBED', NOW)
    expect(repo.resolve).toHaveBeenCalledWith(['c'], 'FLAGGED', NOW)
    expect(repo.resolve).toHaveBeenCalledWith(['d'], 'SKIPPED', NOW)
    expect(auditMutation).toHaveBeenCalledTimes(2)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_subscriber',
        action: 'opt_out',
        targetId: 's-b',
        meta: expect.objectContaining({ reason: 'inativo' }),
      }),
    )
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        newsletterId: 'nl1',
        phase: 'resolved',
        reengaged: 1,
        unsubscribed: 1,
        flagged: 1,
        runKey: '2026-10-28',
      }),
    )
  })

  it('pages through full pages and skips notices with nothing decided', async () => {
    const page = Array.from({ length: 500 }, (_, index) =>
      due({ id: `x${index}`, subscriberStatus: 'UNSUBSCRIBED' }),
    )
    repo.listDue.mockResolvedValueOnce(ok(page)).mockResolvedValueOnce(ok([]))
    expect(expectOk(await Service.resolveDue(NOW)).skipped).toBe(500)
    expect(repo.listDue).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('skips the notice when the newsletter is gone', async () => {
    repo.listDue.mockResolvedValueOnce(ok([due({ action: 'FLAG' })]))
    issues.findNewsletter.mockResolvedValue(ok(null))
    expectOk(await Service.resolveDue(NOW))
    issues.findNewsletter.mockResolvedValue(err(databaseError()))
    repo.listDue.mockResolvedValueOnce(ok([due({ action: 'FLAG' })]))
    expectOk(await Service.resolveDue(NOW))
    expect(notify).not.toHaveBeenCalled()
  })

  it('propagates DB errors', async () => {
    repo.listDue.mockResolvedValue(ok([due()]))
    repo.resolve.mockResolvedValue(err(databaseError()))
    expectErr(await Service.resolveDue(NOW), 'DATABASE_ERROR')
    repo.unsubscribeInactive.mockResolvedValue(err(databaseError()))
    expectErr(await Service.resolveDue(NOW), 'DATABASE_ERROR')
    repo.listDue.mockResolvedValue(err(databaseError()))
    expectErr(await Service.resolveDue(NOW), 'DATABASE_ERROR')
  })
})

describe('CrmNewsletterReengagementService — public button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findWithContext.mockResolvedValue(ok(context()))
    repo.reengage.mockResolvedValue(ok(false))
  })

  const token = createReengageToken('re1')

  it('shows the page data without writing', async () => {
    expect(expectOk(await Service.reengagePreview(token))).toEqual({
      email: 'ana@example.com',
      newsletterName: 'Novidades',
      publisherName: 'Acme',
      alreadyConfirmed: false,
    })
    repo.findWithContext.mockResolvedValue(ok(context({ reengagedAt: NOW })))
    expect(
      expectOk(await Service.reengagePreview(token)).alreadyConfirmed,
    ).toBe(true)
    expect(repo.reengage).not.toHaveBeenCalled()
  })

  it('refuses bad tokens and missing attempts', async () => {
    expectErr(
      await Service.reengagePreview('bad'),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    expectErr(
      await Service.reengage('bad', NOW),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    repo.findWithContext.mockResolvedValue(ok(null))
    expectErr(
      await Service.reengagePreview(token),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    repo.findWithContext.mockResolvedValue(err(databaseError()))
    expectErr(await Service.reengage(token, NOW), 'DATABASE_ERROR')
  })

  it('reengages an active subscriber and brings back an inactive one', async () => {
    expect(expectOk(await Service.reengage(token, NOW))).toEqual({
      newsletterName: 'Novidades',
      resubscribed: false,
    })
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'update', targetId: 's1' }),
    )

    repo.findWithContext.mockResolvedValue(
      ok(
        context({
          subscriber: {
            id: 's1',
            status: 'UNSUBSCRIBED',
            unsubscribeReason: 'inativo',
          },
        }),
      ),
    )
    repo.reengage.mockResolvedValue(ok(true))
    expect(expectOk(await Service.reengage(token, NOW)).resubscribed).toBe(true)
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'opt_in' }),
    )

    repo.reengage.mockResolvedValue(err(databaseError()))
    expectErr(await Service.reengage(token, NOW), 'DATABASE_ERROR')
  })

  it('never overrides a subscriber who left on purpose or bounced', async () => {
    for (const subscriber of [
      { id: 's1', status: 'UNSUBSCRIBED', unsubscribeReason: 'outro' },
      { id: 's1', status: 'BOUNCED', unsubscribeReason: null },
    ]) {
      repo.findWithContext.mockResolvedValue(ok(context({ subscriber })))
      expect(expectOk(await Service.reengage(token, NOW))).toEqual({
        newsletterName: 'Novidades',
        resubscribed: false,
      })
    }
    expect(repo.reengage).not.toHaveBeenCalled()
  })
})
