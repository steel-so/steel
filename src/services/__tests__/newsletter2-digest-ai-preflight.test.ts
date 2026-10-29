import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { ok } from '@/src/lib/result'

vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock(
  '@/src/repositories/crm-newsletter-issue.repository',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CrmNewsletterIssueRepository: {
      findNewsletter: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
      slugTaken: vi.fn(),
      create: vi.fn(),
      updateEditable: vi.fn(),
      softDeleteDraft: vi.fn(),
      countAudience: vi.fn(),
      listLastSent: vi.fn(),
    },
  }),
)
vi.mock('@/src/repositories/crm-newsletter-delivery.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock('@/src/services/crm-newsletter-render', () => ({
  renderIssueBase: vi.fn(),
  issueChecklist: vi.fn(() => []),
  personalizeIssue: vi.fn(() => ({
    subject: 'S',
    html: '<p>h</p>',
    text: 't',
  })),
  validateIssueDocument: vi.fn(),
}))
vi.mock('@/src/services/crm-newsletter-usage.service', () => ({
  CrmNewsletterUsageService: {
    getUsage: vi.fn(),
    remaining: (usage: { limit: number | null; emailsSent: number }) =>
      usage.limit === null ? null : Math.max(0, usage.limit - usage.emailsSent),
  },
}))
vi.mock('@/src/lib/sending-domain/resolve-sender', () => ({
  resolveVerifiedSender: vi.fn(),
}))
vi.mock('@/src/lib/mail/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/src/lib/crm-newsletter/test-send-limiter', () => ({
  newsletterTestSendLimiter: {},
}))
vi.mock('@/src/lib/rate-limit', () => ({ consume: vi.fn() }))

import { consume } from '@/src/lib/rate-limit'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { assertModuleMember } from '../authz'
import { CrmNewsletterIssueService as Service } from '../crm-newsletter-issue.service'
import {
  renderIssueBase,
  validateIssueDocument,
} from '../crm-newsletter-render'
import { CrmNewsletterUsageService } from '../crm-newsletter-usage.service'

const issues = vi.mocked(CrmNewsletterIssueRepository)
const deliveries = vi.mocked(CrmNewsletterDeliveryRepository)
const _templates = vi.mocked(CrmEmailTemplateRepository)
const authz = vi.mocked(assertModuleMember)
const usage = vi.mocked(CrmNewsletterUsageService)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1'] as const

function member(isPrivileged = false) {
  authz.mockResolvedValue(
    ok({
      role: isPrivileged ? 'ADMIN' : 'MEMBER',
      isPrivileged,
      permissions: null,
    }),
  )
}

function withIssue(
  overrides?: Parameters<typeof createFakeNewsletterIssue>[0],
) {
  const issue = createFakeNewsletterIssue(overrides)
  issues.findById.mockResolvedValue(ok(issue))
  return issue
}

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

describe('newsletter2 nl2-digest-ai: preflight of an A/B test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    member()
    issues.findNewsletter.mockResolvedValue(ok(createFakeNewsletter()))
    issues.slugTaken.mockResolvedValue(ok(false))
    deliveries.statsFor.mockResolvedValue(ok(new Map()))
    vi.mocked(resolveVerifiedSender).mockResolvedValue(
      ok({ sendingDomainId: 'd1' }),
    )
    vi.mocked(renderIssueBase).mockResolvedValue(ok(base))
    vi.mocked(validateIssueDocument).mockImplementation((doc) =>
      ok(doc as never),
    )
    vi.mocked(consume).mockResolvedValue(ok(undefined))
    usage.getUsage.mockResolvedValue(
      ok({ month: '2026-10', emailsSent: 0, limit: 3000, limitSource: 'PLAN' }),
    )
  })

  it('blocks an A/B test below the minimum audience', async () => {
    withIssue({ abSubjectB: 'Assunto B', abTestPercent: 20 })
    issues.countAudience.mockResolvedValue(ok(10))
    const result = expectOk(await Service.preflight(...A, 'is1', NOW))
    expect(result.blockers).toEqual([
      {
        code: 'AB_AUDIENCE_TOO_SMALL',
        message:
          'O teste A/B de assunto precisa de pelo menos 20 assinantes ativos',
      },
    ])
  })

  it('does not add it with no audience or enough audience', async () => {
    withIssue({ abSubjectB: 'Assunto B', abTestPercent: 20 })
    issues.countAudience.mockResolvedValue(ok(0))
    expect(
      expectOk(await Service.preflight(...A, 'is1', NOW)).blockers.map(
        (b) => b.code,
      ),
    ).toEqual(['NO_SUBSCRIBERS'])
    issues.countAudience.mockResolvedValue(ok(25))
    expect(
      expectOk(await Service.preflight(...A, 'is1', NOW)).blockers,
    ).toEqual([])
  })

  it('exposes the A/B test on the issue DTO', async () => {
    withIssue({ abSubjectB: 'Assunto B' })
    const issue = expectOk(await Service.get(...A, 'is1'))
    expect(issue.abTest?.subjectB).toBe('Assunto B')
  })
})
