import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueIncomplete,
  databaseError,
  forbidden,
  sendingDomainNotVerified,
} from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'
import type { ClaimedRecipient } from '@/src/repositories/crm-newsletter-delivery.repository'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock(
  '@/src/repositories/crm-newsletter-issue.repository',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CrmNewsletterIssueRepository: {
      findNewsletter: vi.fn(),
      findById: vi.fn(),
      findByIdUnscoped: vi.fn(),
      transition: vi.fn(),
      startSending: vi.fn(),
      countAudience: vi.fn(),
      listDue: vi.fn(),
      listSending: vi.fn(),
    },
  }),
)
vi.mock('@/src/repositories/crm-newsletter-delivery.repository')
vi.mock('@/src/services/crm-newsletter-render', () => ({
  renderIssueBase: vi.fn(),
  issueChecklist: vi.fn(() => []),
  loadRecipientFacts: vi.fn(),
  personalizeIssue: vi.fn(() => ({
    subject: 'S',
    html: '<p>h</p>',
    text: 'texto',
  })),
  webVersionOf: vi.fn(() => ({
    subject: 'S',
    html: '<p>web</p>',
    text: 'Web',
  })),
  validateIssueDocument: vi.fn(),
}))
vi.mock('@/src/services/crm-newsletter-usage.service', () => ({
  CrmNewsletterUsageService: {
    getUsage: vi.fn(),
    record: vi.fn(),
    remaining: (usage: { limit: number | null; emailsSent: number }) =>
      usage.limit === null ? null : Math.max(0, usage.limit - usage.emailsSent),
  },
}))
vi.mock('@/src/services/crm-newsletter-notifications', () => ({
  notifyNewsletterIssueFinished: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/sending-domain/resolve-sender', () => ({
  resolveVerifiedSender: vi.fn(),
}))
vi.mock('@/src/lib/mail/send-batch', () => ({ sendEmailBatch: vi.fn() }))
const add = vi.hoisted(() => vi.fn())
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmNewsletterQueue: () => ({ add }),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { sendEmailBatch } from '@/src/lib/mail/send-batch'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { assertModuleMember } from '../authz'
import { notifyNewsletterIssueFinished } from '../crm-newsletter-notifications'
import {
  issueChecklist,
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
} from '../crm-newsletter-render'
import {
  BATCH_INTERVAL_MS,
  DISPATCH_BATCH,
  preSendChecks,
  CrmNewsletterSendService as Service,
} from '../crm-newsletter-send.service'
import { CrmNewsletterUsageService } from '../crm-newsletter-usage.service'

const issues = vi.mocked(CrmNewsletterIssueRepository)
const deliveries = vi.mocked(CrmNewsletterDeliveryRepository)
const usage = vi.mocked(CrmNewsletterUsageService)
const batch = vi.mocked(sendEmailBatch)
const authz = vi.mocked(assertModuleMember)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1'] as const
const newsletter = createFakeNewsletter()

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

function stats(sent: number, failed = 0) {
  return new Map([
    [
      'is1',
      {
        recipients: sent + failed,
        sent,
        skipped: 0,
        failed,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        complained: 0,
        unsubscribed: 0,
      },
    ],
  ])
}

function claimed(count: number, over: Partial<ClaimedRecipient> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    subscriberId: `s${index}`,
    email: `p${index}@acme.com.br`,
    name: index === 0 ? null : `P${index}`,
    personId: index === 1 ? 'person1' : null,
    subscriberStatus: 'ACTIVE',
    ...over,
  }))
}

function usageOf(emailsSent: number, limit: number | null = 3000) {
  return ok({
    month: '2026-10',
    emailsSent,
    limit,
    limitSource: 'PLAN' as const,
  })
}

describe('CrmNewsletterSendService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authz.mockResolvedValue(
      ok({ role: 'MEMBER', isPrivileged: false, permissions: null }),
    )
    issues.findNewsletter.mockResolvedValue(ok(newsletter))
    issues.findById.mockResolvedValue(ok(createFakeNewsletterIssue()))
    issues.countAudience.mockResolvedValue(ok(10))
    issues.transition.mockImplementation(async (_id, _from, data) =>
      ok(createFakeNewsletterIssue(data as never)),
    )
    issues.startSending.mockResolvedValue(
      ok({
        issue: createFakeNewsletterIssue({ status: 'SENDING', number: 1 }),
        recipients: 10,
      }),
    )
    vi.mocked(resolveVerifiedSender).mockResolvedValue(
      ok({ sendingDomainId: 'd1' }),
    )
    vi.mocked(renderIssueBase).mockResolvedValue(ok(base))
    vi.mocked(loadRecipientFacts).mockResolvedValue(
      ok({
        people: new Map([
          ['person1', { email: 'x', name: 'Pessoa', city: 'Recife' }],
        ]),
        lists: new Map([['p0@acme.com.br', ['l1']]]),
      }),
    )
    usage.getUsage.mockResolvedValue(usageOf(0))
    usage.record.mockResolvedValue(usageOf(0))
    deliveries.countOpen.mockResolvedValue(ok(0))
    deliveries.statsFor.mockResolvedValue(ok(stats(10)))
    deliveries.optedOut.mockResolvedValue(ok(new Set()))
    deliveries.markSkipped.mockResolvedValue(ok(undefined))
    deliveries.markSent.mockResolvedValue(ok(undefined))
    deliveries.markFailed.mockResolvedValue(ok(undefined))
    deliveries.release.mockResolvedValue(ok(undefined))
    batch.mockImplementation(async (emails) => emails.map((_, i) => `m${i}`))
  })

  describe('preSendChecks', () => {
    const issue = createFakeNewsletterIssue()

    it('passes and returns the audience and the base render', async () => {
      const result = expectOk(await preSendChecks(issue, newsletter, NOW))
      expect(result.audience).toBe(10)
    })

    it('fails in the contract order', async () => {
      expectErr(
        await preSendChecks(
          issue,
          createFakeNewsletter({ status: 'ARCHIVED' }),
          NOW,
        ),
        'CRM_NEWSLETTER_ARCHIVED',
      )
      vi.mocked(resolveVerifiedSender).mockResolvedValueOnce(
        err(sendingDomainNotVerified()),
      )
      expectErr(
        await preSendChecks(issue, newsletter, NOW),
        'SENDING_DOMAIN_NOT_VERIFIED',
      )
      vi.mocked(renderIssueBase).mockResolvedValueOnce(
        err(crmNewsletterIssueIncomplete()),
      )
      expectErr(
        await preSendChecks(issue, newsletter, NOW),
        'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      )
      vi.mocked(issueChecklist).mockReturnValueOnce([
        { code: 'SUBJECT_EMPTY', level: 'error', message: 'Sem assunto' },
      ])
      const incomplete = expectErr(
        await preSendChecks(issue, newsletter, NOW),
        'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      )
      expect(incomplete.message).toBe('Sem assunto')
      issues.countAudience.mockResolvedValueOnce(err(databaseError()))
      expectErr(await preSendChecks(issue, newsletter, NOW), 'DATABASE_ERROR')
      issues.countAudience.mockResolvedValueOnce(ok(0))
      expectErr(
        await preSendChecks(issue, newsletter, NOW),
        'CRM_NEWSLETTER_NO_SUBSCRIBERS',
      )
      usage.getUsage.mockResolvedValueOnce(err(databaseError()))
      expectErr(await preSendChecks(issue, newsletter, NOW), 'DATABASE_ERROR')
      usage.getUsage.mockResolvedValueOnce(usageOf(2995))
      const limited = expectErr(
        await preSendChecks(issue, newsletter, NOW),
        'CRM_NEWSLETTER_LIMIT_REACHED',
      )
      expect(limited.message).toContain('restam 5 de 3.000')
      usage.getUsage.mockResolvedValueOnce(usageOf(1_000_000, null))
      expectOk(await preSendChecks(issue, newsletter, NOW))
    })
  })

  describe('send', () => {
    it('starts now: snapshot, first dispatch, audit', async () => {
      const dto = expectOk(await Service.send(...A, 'is1', {}, NOW))
      expect(dto.status).toBe('SENDING')
      expect(issues.startSending).toHaveBeenCalledWith('is1', {
        webHtml: '<p>web</p>',
        excerpt: 'Web',
        now: NOW,
      })
      expect(add).toHaveBeenCalledWith(
        'dispatch',
        { issueId: 'is1' },
        expect.objectContaining({ delay: 0 }),
      )
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_newsletter_issue',
          action: 'send',
          actorId: 'u1',
        }),
      )
    })

    it('schedules at least 5 minutes ahead', async () => {
      expectErr(
        await Service.send(
          ...A,
          'is1',
          { scheduledAt: new Date(NOW.getTime() + 60_000).toISOString() },
          NOW,
        ),
        'VALIDATION_ERROR',
      )
      const at = new Date(NOW.getTime() + 10 * 60_000).toISOString()
      const dto = expectOk(
        await Service.send(...A, 'is1', { scheduledAt: at }, NOW),
      )
      expect(dto.status).toBe('SCHEDULED')
      expect(issues.startSending).not.toHaveBeenCalled()
      issues.transition.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.send(...A, 'is1', { scheduledAt: at }, NOW))
      issues.transition.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.send(...A, 'is1', { scheduledAt: at }, NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
    })

    it('refuses locked issues, failed checks and lost races', async () => {
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.send(...A, 'is1', {}, NOW), 'FORBIDDEN')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.send(...A, 'is1', {}, NOW))
      issues.findById.mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'SENT' })),
      )
      expectErr(
        await Service.send(...A, 'is1', {}, NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      issues.countAudience.mockResolvedValueOnce(ok(0))
      expectErr(
        await Service.send(...A, 'is1', {}, NOW),
        'CRM_NEWSLETTER_NO_SUBSCRIBERS',
      )
      issues.startSending.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.send(...A, 'is1', {}, NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      issues.startSending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.send(...A, 'is1', {}, NOW), 'DATABASE_ERROR')
      expect(add).not.toHaveBeenCalled()
    })
  })

  describe('cancel and stop', () => {
    it('cancels a schedule back to draft', async () => {
      issues.findById.mockResolvedValue(
        ok(createFakeNewsletterIssue({ status: 'SCHEDULED' })),
      )
      const dto = expectOk(await Service.cancel(...A, 'is1', NOW))
      expect(dto.status).toBe('DRAFT')
      expect(issues.transition).toHaveBeenCalledWith(
        'is1',
        ['SCHEDULED'],
        expect.objectContaining({ status: 'DRAFT', scheduledAt: null }),
      )
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cancel' }),
      )
      issues.transition.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.cancel(...A, 'is1', NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      issues.transition.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.cancel(...A, 'is1', NOW))
    })

    it('refuses to cancel what is not scheduled', async () => {
      expectErr(await Service.cancel(...A, 'is1', NOW), 'VALIDATION_ERROR')
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.cancel(...A, 'is1', NOW), 'FORBIDDEN')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.cancel(...A, 'is1', NOW))
    })

    it('stops a send: skips pending rows and closes the issue', async () => {
      issues.findById
        .mockResolvedValueOnce(
          ok(createFakeNewsletterIssue({ status: 'SENDING' })),
        )
        .mockResolvedValueOnce(
          ok(createFakeNewsletterIssue({ status: 'SENT' })),
        )
      deliveries.skipPending.mockResolvedValue(ok(5))
      issues.transition.mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'SENT' })),
      )
      const dto = expectOk(await Service.stop(...A, 'is1', NOW))
      expect(dto.status).toBe('SENT')
      expect(deliveries.skipPending).toHaveBeenCalledWith('is1', 'STOPPED')
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'stop' }),
      )
    })

    it('stop: nothing sent yet → CANCELED; errors propagate', async () => {
      issues.findById.mockResolvedValue(
        ok(createFakeNewsletterIssue({ status: 'SENDING' })),
      )
      deliveries.skipPending.mockResolvedValue(ok(10))
      deliveries.statsFor.mockResolvedValue(ok(stats(0)))
      expectOk(await Service.stop(...A, 'is1', NOW))
      expect(issues.transition).toHaveBeenCalledWith(
        'is1',
        ['SENDING'],
        expect.objectContaining({ status: 'CANCELED', canceledAt: NOW }),
      )
      deliveries.skipPending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.stop(...A, 'is1', NOW))
      issues.findById
        .mockResolvedValueOnce(
          ok(createFakeNewsletterIssue({ status: 'SENDING' })),
        )
        .mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.stop(...A, 'is1', NOW))
      issues.findById.mockResolvedValueOnce(ok(createFakeNewsletterIssue()))
      expectErr(await Service.stop(...A, 'is1', NOW), 'VALIDATION_ERROR')
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.stop(...A, 'is1', NOW), 'FORBIDDEN')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.stop(...A, 'is1', NOW))
    })
  })

  describe('dispatch', () => {
    function sendingIssue(over = {}) {
      issues.findByIdUnscoped.mockResolvedValue(
        ok({
          ...createFakeNewsletterIssue({ status: 'SENDING', ...over }),
          newsletter: createFakeNewsletter({ replyTo: 'r@acme.com.br' }),
        }),
      )
    }

    it('ignores missing and inactive issues', async () => {
      issues.findByIdUnscoped.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'missing',
      })
      sendingIssue({ status: 'SENT' })
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'inactive',
      })
      issues.findByIdUnscoped.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
    })

    it('closes a drained issue and notifies the creator', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok([]))
      issues.transition.mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'SENT' })),
      )
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'drained',
      })
      expect(issues.transition).toHaveBeenCalledWith(
        'is1',
        ['SENDING'],
        expect.objectContaining({ status: 'SENT', sentAt: NOW }),
      )
      expect(notifyNewsletterIssueFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', sent: 10 }),
      )
      deliveries.claimBatch.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
    })

    it('sends a full batch, records it and queues the next one', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok(claimed(DISPATCH_BATCH)))
      const outcome = expectOk(await Service.dispatch('is1', NOW))
      expect(outcome).toEqual({
        status: 'sent',
        sent: DISPATCH_BATCH,
        skipped: 0,
        failed: 0,
        more: true,
      })
      const emails = batch.mock.calls[0][0]
      expect(emails[0]).toMatchObject({
        from: '"Acme" <news@news.acme.com.br>',
        to: 'p0@acme.com.br',
        replyTo: 'r@acme.com.br',
        tags: [
          { name: 'kind', value: 'newsletter' },
          { name: 'issue', value: 'is1' },
        ],
      })
      expect(emails[0].headers?.['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      )
      expect(batch.mock.calls[0][1]).toEqual({
        idempotencyKey: `crm-newsletter-is1-r0-${DISPATCH_BATCH}`,
      })
      // Personalization: CRM person fields and list memberships.
      const calls = vi.mocked(personalizeIssue).mock.calls
      expect(calls[1][1].contact).toMatchObject({ city: 'Recife', name: 'P1' })
      expect(calls[0][1].listIds).toEqual(['l1'])
      expect(deliveries.markSent).toHaveBeenCalled()
      expect(usage.record).toHaveBeenCalledWith('ws1', DISPATCH_BATCH, NOW)
      expect(add).toHaveBeenCalledWith(
        'dispatch',
        { issueId: 'is1' },
        expect.objectContaining({ delay: BATCH_INTERVAL_MS }),
      )
    })

    it('skips opted-out, left and over-quota rows', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(
        ok([
          ...claimed(1),
          ...claimed(1, { id: 'out', email: 'OUT@acme.com.br' }),
          ...claimed(1, { id: 'b', subscriberStatus: 'BOUNCED' }),
          ...claimed(1, { id: 'c', subscriberStatus: 'COMPLAINED' }),
          ...claimed(1, { id: 'u', subscriberStatus: 'UNSUBSCRIBED' }),
          ...claimed(1, { id: 'q', email: 'q@acme.com.br' }),
        ]),
      )
      deliveries.optedOut.mockResolvedValue(ok(new Set(['out@acme.com.br'])))
      usage.getUsage.mockResolvedValue(usageOf(2999))
      const outcome = expectOk(await Service.dispatch('is1', NOW))
      expect(outcome).toMatchObject({ sent: 1, skipped: 5, more: false })
      const reasons = Object.fromEntries(
        deliveries.markSkipped.mock.calls.map(([ids, reason]) => [reason, ids]),
      )
      expect(reasons).toEqual({
        OPTED_OUT: ['out'],
        BOUNCED: ['b'],
        COMPLAINED: ['c'],
        UNSUBSCRIBED: ['u'],
        LIMIT_REACHED: ['q'],
      })
    })

    it('skips everything without calling Resend when nothing is eligible', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(
        ok(claimed(2, { subscriberStatus: 'UNSUBSCRIBED' })),
      )
      const outcome = expectOk(await Service.dispatch('is1', NOW))
      expect(outcome).toMatchObject({ sent: 0, skipped: 2 })
      expect(batch).not.toHaveBeenCalled()
    })

    it('gives rows back on read failures', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok(claimed(2)))
      deliveries.optedOut.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
      usage.getUsage.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
      deliveries.markSkipped.mockResolvedValueOnce(err(databaseError()))
      deliveries.claimBatch.mockResolvedValueOnce(
        ok(claimed(1, { subscriberStatus: 'BOUNCED' })),
      )
      expectErr(await Service.dispatch('is1', NOW))
      vi.mocked(loadRecipientFacts).mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
      expect(deliveries.release).toHaveBeenCalledTimes(4)
    })

    it('retries transient provider errors and fails permanent ones', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok(claimed(2)))
      batch.mockRejectedValueOnce(new Error('429 Too many requests'))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'retry',
        reason: '429 Too many requests',
      })
      expect(deliveries.release).toHaveBeenCalledWith(['r0', 'r1'])

      batch.mockRejectedValueOnce(new Error('Invalid from'))
      deliveries.statsFor.mockResolvedValueOnce(ok(stats(0, 2)))
      issues.transition.mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'FAILED' })),
      )
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        sent: 0,
        failed: 2,
      })
      expect(deliveries.markFailed).toHaveBeenCalledWith(
        ['r0', 'r1'],
        'Invalid from',
      )
      expect(issues.transition).toHaveBeenLastCalledWith(
        'is1',
        ['SENDING'],
        expect.objectContaining({ status: 'FAILED' }),
      )

      batch.mockRejectedValueOnce('weird')
      expectOk(await Service.dispatch('is1', NOW))
      expect(deliveries.markFailed).toHaveBeenLastCalledWith(
        ['r0', 'r1'],
        'Falha ao enviar o lote',
      )
      batch.mockRejectedValueOnce(new Error('bad'))
      deliveries.markFailed.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
    })

    it('fails the batch when the content no longer renders', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok(claimed(1)))
      vi.mocked(renderIssueBase).mockResolvedValueOnce(
        err(crmNewsletterIssueIncomplete('Rodapé')),
      )
      expectOk(await Service.dispatch('is1', NOW))
      expect(deliveries.markFailed).toHaveBeenCalledWith(['r0'], 'Rodapé')
      vi.mocked(renderIssueBase).mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW))
    })

    it('never fails after Resend accepted the batch', async () => {
      sendingIssue()
      deliveries.claimBatch.mockResolvedValue(ok(claimed(1)))
      deliveries.markSent.mockResolvedValueOnce(err(databaseError()))
      usage.record.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        sent: 1,
      })
    })
  })

  describe('completeIfDrained', () => {
    it('waits for open rows and tolerates read failures and lost races', async () => {
      deliveries.countOpen.mockResolvedValueOnce(ok(3))
      await Service.completeIfDrained('is1', NOW)
      deliveries.countOpen.mockResolvedValueOnce(err(databaseError()))
      await Service.completeIfDrained('is1', NOW)
      deliveries.statsFor.mockResolvedValueOnce(err(databaseError()))
      await Service.completeIfDrained('is1', NOW)
      issues.transition.mockResolvedValueOnce(ok(null))
      await Service.completeIfDrained('is1', NOW)
      expect(notifyNewsletterIssueFinished).not.toHaveBeenCalled()
      deliveries.statsFor.mockResolvedValueOnce(ok(new Map()))
      await Service.completeIfDrained('is1', NOW)
      expect(notifyNewsletterIssueFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', sent: 0 }),
      )
    })
  })

  describe('tick', () => {
    it('releases stuck rows, starts due schedules and re-dispatches', async () => {
      deliveries.releaseStuck.mockResolvedValue(ok(2))
      const due = createFakeNewsletterIssue({ status: 'SCHEDULED' })
      issues.listDue.mockResolvedValue(
        ok([
          due,
          { ...due, id: 'is2' },
          { ...due, id: 'is3' },
          { ...due, id: 'is4' },
        ]),
      )
      issues.findByIdUnscoped
        // is1: starts
        .mockResolvedValueOnce(ok({ ...due, newsletter }))
        // is2: checks fail → FAILED
        .mockResolvedValueOnce(
          ok({
            ...due,
            id: 'is2',
            newsletter: createFakeNewsletter({ status: 'ARCHIVED' }),
          }),
        )
        // is3: database error
        .mockResolvedValueOnce(err(databaseError()))
        // is4: already handled by someone else
        .mockResolvedValueOnce(ok(null))
      issues.transition.mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ id: 'is2', status: 'FAILED' })),
      )
      issues.listSending.mockResolvedValue(
        ok([createFakeNewsletterIssue({ status: 'SENDING' })]),
      )
      const result = expectOk(await Service.tick(NOW))
      expect(result).toEqual({
        released: 2,
        started: 1,
        failed: 1,
        dispatched: 1,
      })
      expect(issues.transition).toHaveBeenCalledWith(
        'is2',
        ['SCHEDULED'],
        expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringContaining('arquivada'),
        }),
      )
      expect(notifyNewsletterIssueFinished).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'is2', status: 'FAILED' }),
      )
    })

    it('propagates the tick reads', async () => {
      deliveries.releaseStuck.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.tick(NOW))
      deliveries.releaseStuck.mockResolvedValue(ok(0))
      issues.listDue.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.tick(NOW))
      issues.listDue.mockResolvedValue(ok([]))
      issues.listSending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.tick(NOW))
    })
  })

  describe('startScheduled', () => {
    const due = createFakeNewsletterIssue({ status: 'SCHEDULED' })

    it('handles races, database errors and start failures', async () => {
      issues.findByIdUnscoped.mockResolvedValueOnce(
        ok({ ...due, status: 'DRAFT', newsletter }),
      )
      expect(expectOk(await Service.startScheduled(due, NOW))).toBe('lost')

      issues.findByIdUnscoped.mockResolvedValue(ok({ ...due, newsletter }))
      issues.countAudience.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.startScheduled(due, NOW), 'DATABASE_ERROR')

      issues.countAudience.mockResolvedValueOnce(ok(0))
      issues.transition.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.startScheduled(due, NOW))

      issues.countAudience.mockResolvedValueOnce(ok(0))
      issues.transition.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.startScheduled(due, NOW))).toBe('lost')

      issues.startSending.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.startScheduled(due, NOW))).toBe('lost')
      issues.startSending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.startScheduled(due, NOW))
    })
  })
})
