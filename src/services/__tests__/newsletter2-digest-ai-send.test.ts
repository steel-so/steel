import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
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
import {
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
} from '../crm-newsletter-render'
import {
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

describe('newsletter2 nl2-digest-ai: A/B test and system send', () => {
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

  const abIssue = (over = {}) =>
    createFakeNewsletterIssue({
      abSubjectB: 'Assunto B',
      abTestPercent: 20,
      abMetric: 'OPENS',
      abWaitHours: 4,
      ...over,
    })

  describe('preSendChecks with an A/B test', () => {
    it('needs the minimum audience', async () => {
      issues.countAudience.mockResolvedValueOnce(ok(19))
      const error = expectErr(
        await preSendChecks(abIssue(), newsletter, NOW),
        'CRM_NEWSLETTER_AB_AUDIENCE_TOO_SMALL',
      )
      expect(error.message).toContain('20 assinantes')
      issues.countAudience.mockResolvedValueOnce(ok(20))
      expect(
        expectOk(await preSendChecks(abIssue(), newsletter, NOW)).audience,
      ).toBe(20)
    })
  })

  describe('send() with an A/B test', () => {
    it('splits the snapshot with the test share', async () => {
      issues.findById.mockResolvedValueOnce(ok(abIssue()))
      issues.countAudience.mockResolvedValue(ok(100))
      expectOk(await Service.send(...A, 'is1', {}, NOW))
      const input = issues.startSending.mock.calls[0][1]
      expect(input.abShare?.(100)).toBe(20)
      expect(input.abShare?.(5)).toBe(2)
    })

    it('does not split without a test', async () => {
      expectOk(await Service.send(...A, 'is1', {}, NOW))
      expect(issues.startSending.mock.calls[0][1].abShare).toBeUndefined()
    })
  })

  describe('sendBatch() with an A/B test', () => {
    it('sends B to the B rows and the winner to the released rest', async () => {
      const rows = [
        ...claimed(1, { id: 'ra', abVariant: 'A' }),
        ...claimed(1, { id: 'rb', abVariant: 'B' }),
        ...claimed(1, { id: 'rr', abVariant: null }),
      ]
      expectOk(
        await Service.sendBatch(
          abIssue({ status: 'SENDING', abWinner: 'B' }),
          newsletter,
          rows,
          NOW,
        ),
      )
      const subjects = vi
        .mocked(personalizeIssue)
        .mock.calls.map(([render]) => render.email.subject)
      expect(subjects).toEqual(['S', 'Assunto B', 'Assunto B'])
    })

    it('uses A before a winner exists and without a test', async () => {
      expectOk(
        await Service.sendBatch(
          abIssue({ status: 'SENDING' }),
          newsletter,
          claimed(1, { abVariant: null }),
          NOW,
        ),
      )
      expectOk(
        await Service.sendBatch(
          createFakeNewsletterIssue({ status: 'SENDING' }),
          newsletter,
          claimed(1, { abVariant: 'B' }),
          NOW,
        ),
      )
      const subjects = vi
        .mocked(personalizeIssue)
        .mock.calls.map(([render]) => render.email.subject)
      expect(subjects).toEqual(['S', 'S'])
    })
  })

  describe('sendNowAsSystem()', () => {
    const found = (over = {}) =>
      ok({ ...createFakeNewsletterIssue(over), newsletter })

    it('starts a draft after the checks and audits as system', async () => {
      issues.findByIdUnscoped.mockResolvedValueOnce(found())
      expect(expectOk(await Service.sendNowAsSystem('is1', NOW))).toEqual({
        started: true,
      })
      expect(issues.startSending).toHaveBeenCalled()
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null, action: 'send' }),
      )
    })

    it('refuses with the pt-BR reason when a check fails or it is not a draft', async () => {
      issues.findByIdUnscoped.mockResolvedValueOnce(found())
      issues.countAudience.mockResolvedValueOnce(ok(0))
      expect(expectOk(await Service.sendNowAsSystem('is1', NOW))).toEqual({
        started: false,
        refused: 'A newsletter ainda não tem assinantes ativos',
      })
      issues.findByIdUnscoped.mockResolvedValueOnce(found({ status: 'SENT' }))
      expect(expectOk(await Service.sendNowAsSystem('is1', NOW)).started).toBe(
        false,
      )
      issues.findByIdUnscoped.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.sendNowAsSystem('is1', NOW)).started).toBe(
        false,
      )
      issues.findByIdUnscoped.mockResolvedValueOnce(found())
      issues.startSending.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.sendNowAsSystem('is1', NOW)).started).toBe(
        false,
      )
    })

    it('propagates database errors', async () => {
      issues.findByIdUnscoped.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.sendNowAsSystem('is1', NOW), 'DATABASE_ERROR')
      issues.findByIdUnscoped.mockResolvedValueOnce(found())
      issues.countAudience.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.sendNowAsSystem('is1', NOW), 'DATABASE_ERROR')
      issues.findByIdUnscoped.mockResolvedValueOnce(found())
      issues.startSending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.sendNowAsSystem('is1', NOW), 'DATABASE_ERROR')
    })
  })
})
