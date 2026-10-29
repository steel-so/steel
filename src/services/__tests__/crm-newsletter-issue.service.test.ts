import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
  createFakeNewsletterRecipient,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmEmailCanvasInvalid,
  crmNewsletterIssueIncomplete,
  databaseError,
  forbidden,
  notFound,
  rateLimited,
  sendingDomainNotVerified,
} from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'

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

import { sendEmail } from '@/src/lib/mail/send'
import { consume } from '@/src/lib/rate-limit'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { assertModuleMember } from '../authz'
import {
  issueWebUrl,
  limitMessage,
  CrmNewsletterIssueService as Service,
} from '../crm-newsletter-issue.service'
import {
  issueChecklist,
  renderIssueBase,
  validateIssueDocument,
} from '../crm-newsletter-render'
import { CrmNewsletterUsageService } from '../crm-newsletter-usage.service'

const issues = vi.mocked(CrmNewsletterIssueRepository)
const deliveries = vi.mocked(CrmNewsletterDeliveryRepository)
const templates = vi.mocked(CrmEmailTemplateRepository)
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

describe('CrmNewsletterIssueService', () => {
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

  describe('scope', () => {
    it('denies without permission and hides other workspaces', async () => {
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(
        await Service.list(...A, { page: 1, pageSize: 25 }),
        'FORBIDDEN',
      )
      expect(authz).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
        resource: 'email',
        action: 'VIEW',
      })
      issues.findNewsletter.mockResolvedValueOnce(ok(null))
      expectErr(await Service.get(...A, 'is1'), 'CRM_NEWSLETTER_NOT_FOUND')
      issues.findNewsletter.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A, 'is1'), 'DATABASE_ERROR')
    })

    it('reports missing issues and read failures', async () => {
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.get(...A, 'x'), 'CRM_NEWSLETTER_ISSUE_NOT_FOUND')
      issues.findById.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A, 'x'), 'DATABASE_ERROR')
    })
  })

  describe('list and get', () => {
    it('lists with stats of non-drafts and the web URL of sent issues', async () => {
      const draft = createFakeNewsletterIssue({ id: 'd' })
      const sent = createFakeNewsletterIssue({
        id: 's',
        status: 'SENT',
        slug: 'outubro',
      })
      issues.list.mockResolvedValue(ok({ items: [draft, sent], total: 2 }))
      const page = expectOk(await Service.list(...A, { page: 1, pageSize: 25 }))
      expect(deliveries.statsFor).toHaveBeenCalledWith(['s'])
      expect(page.total).toBe(2)
      expect(page.items[0].webUrl).toBeNull()
      expect(page.items[1].webUrl).toMatch(/\/n\/acme\/novidades\/outubro$/)

      issues.list.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.list(...A, { page: 1, pageSize: 25 }))
      deliveries.statsFor.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.list(...A, { page: 1, pageSize: 25 }))
    })

    it('gets the issue with its document', async () => {
      withIssue()
      const dto = expectOk(await Service.get(...A, 'is1'))
      expect(dto.builderDocument).toBeDefined()
      deliveries.statsFor.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A, 'is1'))
    })

    it('has no web URL when the archive is off', () => {
      expect(
        issueWebUrl(
          { status: 'SENT', slug: 'x' },
          createFakeNewsletter({ archiveEnabled: false }),
        ),
      ).toBeNull()
    })
  })

  describe('create', () => {
    beforeEach(() => {
      issues.create.mockImplementation(async (data) =>
        ok(
          createFakeNewsletterIssue({
            subject: data.subject,
            slug: data.slug,
            preheader: data.preheader,
            builderDocument: data.builderDocument as never,
          }),
        ),
      )
    })

    it('needs CREATE and an active newsletter', async () => {
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.create(...A, { subject: 'Oi' }), 'FORBIDDEN')
      issues.findNewsletter.mockResolvedValueOnce(
        ok(createFakeNewsletter({ status: 'ARCHIVED' })),
      )
      expectErr(
        await Service.create(...A, { subject: 'Oi' }),
        'CRM_NEWSLETTER_ARCHIVED',
      )
    })

    it('starts blank with a free slug derived from the subject', async () => {
      issues.slugTaken
        .mockResolvedValueOnce(ok(true))
        .mockResolvedValueOnce(ok(false))
      const dto = expectOk(
        await Service.create(...A, { subject: 'Novidades de Outubro' }),
      )
      expect(dto.slug).toBe('novidades-de-outubro-2')
      expect(issues.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: 'u1', preheader: null }),
      )
    })

    it('falls back to a timestamped slug after many collisions', async () => {
      issues.slugTaken.mockResolvedValue(ok(true))
      const dto = expectOk(await Service.create(...A, { subject: 'Oi oi' }))
      expect(dto.slug).toMatch(/^oi-oi-/)
      issues.slugTaken.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.create(...A, { subject: 'Oi' }))
    })

    it('refuses a taken explicit slug', async () => {
      issues.slugTaken.mockResolvedValueOnce(ok(true))
      expectErr(
        await Service.create(...A, { subject: 'Oi', slug: 'taken' }),
        'CONFLICT',
      )
      issues.slugTaken.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.create(...A, { subject: 'Oi', slug: 'x-y' }))
      const dto = expectOk(
        await Service.create(...A, { subject: 'Oi', slug: 'livre' }),
      )
      expect(dto.slug).toBe('livre')
    })

    it('duplicates another issue (document and preheader)', async () => {
      withIssue({ preheader: 'Pré' })
      const dto = expectOk(
        await Service.create(...A, {
          subject: 'Cópia',
          duplicateOfIssueId: 'is1',
        }),
      )
      expect(dto.preheader).toBe('Pré')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.create(...A, {
          subject: 'x',
          duplicateOfIssueId: 'nope',
        }),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
    })

    it('starts from a template (explicit or the newsletter one)', async () => {
      templates.findById.mockResolvedValue(
        ok({ builderDocument: createBlankEmailDocument() } as never),
      )
      expectOk(await Service.create(...A, { subject: 'Oi', templateId: 't1' }))
      expect(templates.findById).toHaveBeenCalledWith('t1', 'ws1')

      templates.findById.mockResolvedValueOnce(
        err(notFound('CrmEmailTemplate')),
      )
      expectErr(
        await Service.create(...A, { subject: 'Oi', templateId: 'gone' }),
        'RESOURCE_NOT_FOUND',
      )

      // The newsletter's template was removed → blank issue.
      issues.findNewsletter.mockResolvedValue(
        ok(createFakeNewsletter({ templateId: 'gone' })),
      )
      templates.findById.mockResolvedValueOnce(
        err(notFound('CrmEmailTemplate')),
      )
      expectOk(await Service.create(...A, { subject: 'Oi' }))
      // A legacy HTML template cannot open → blank issue too.
      templates.findById.mockResolvedValueOnce(
        ok({ builderDocument: null } as never),
      )
      expectOk(await Service.create(...A, { subject: 'Oi' }))
    })

    it('writes the preheader into the document root', async () => {
      const dto = expectOk(
        await Service.create(...A, { subject: 'Oi', preheader: 'Leia já' }),
      )
      expect(dto.preheader).toBe('Leia já')
      const stored = issues.create.mock.lastCall?.[0].builderDocument as {
        rootId: string
        nodes: Record<string, { props: { preheader: string } }>
      }
      expect(stored.nodes[stored.rootId].props.preheader).toBe('Leia já')
      issues.create.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.create(...A, { subject: 'Oi' }))
    })
  })

  describe('update', () => {
    beforeEach(() => {
      issues.updateEditable.mockImplementation(async (_id, data) =>
        ok(createFakeNewsletterIssue(data as never)),
      )
    })

    it('needs EDIT and an editable issue', async () => {
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(
        await Service.update(...A, 'is1', { subject: 'x' }),
        'FORBIDDEN',
      )
      withIssue({ status: 'SENT' })
      expectErr(
        await Service.update(...A, 'is1', { subject: 'x' }),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      withIssue()
      issues.updateEditable.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.update(...A, 'is1', { subject: 'x' }),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.update(...A, 'is1', { subject: 'x' }),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
    })

    it('checks a new slug', async () => {
      withIssue({ slug: 'a' })
      issues.slugTaken.mockResolvedValueOnce(ok(true))
      expectErr(await Service.update(...A, 'is1', { slug: 'b' }), 'CONFLICT')
      issues.slugTaken.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.update(...A, 'is1', { slug: 'b' }))
      expectOk(await Service.update(...A, 'is1', { slug: 'a' }))
      expect(issues.slugTaken).toHaveBeenCalledTimes(2)
    })

    it('validates the document and syncs the preheader column', async () => {
      withIssue()
      vi.mocked(validateIssueDocument).mockReturnValueOnce(
        err(crmNewsletterIssueIncomplete('x')),
      )
      expectErr(
        await Service.update(...A, 'is1', {
          builderDocument: createBlankEmailDocument() as never,
        }),
        'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      )

      const doc = createBlankEmailDocument()
      ;(doc.nodes[doc.rootId].props as { preheader: string }).preheader = 'Pré'
      expectOk(
        await Service.update(...A, 'is1', {
          subject: 'Novo',
          builderDocument: doc as never,
        }),
      )
      expect(issues.updateEditable).toHaveBeenLastCalledWith(
        'is1',
        expect.objectContaining({ subject: 'Novo', preheader: 'Pré' }),
      )

      expectOk(
        await Service.update(...A, 'is1', {
          builderDocument: createBlankEmailDocument() as never,
          preheader: 'Outro',
        }),
      )
      expect(issues.updateEditable.mock.lastCall?.[1].preheader).toBe('Outro')

      expectOk(await Service.update(...A, 'is1', { preheader: null }))
      expect(issues.updateEditable.mock.lastCall?.[1]).toMatchObject({
        preheader: null,
      })
      issues.updateEditable.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.update(...A, 'is1', { subject: 'x' }))
    })

    it('keeps a non-canvas stored document when only the preheader changes', async () => {
      withIssue({ builderDocument: { legacy: true } as never })
      expectOk(await Service.update(...A, 'is1', { preheader: 'x' }))
      expect(issues.updateEditable.mock.lastCall?.[1].builderDocument).toEqual({
        legacy: true,
      })
    })

    it('only admins add or change HTML blocks', async () => {
      withIssue()
      const doc = createBlankEmailDocument()
      const section = doc.nodes[doc.rootId].children?.[0] as string
      const column = doc.nodes[section].children?.[0] as string
      doc.nodes.html1 = {
        id: 'html1',
        type: 'email.html',
        props: {
          html: '<b>x</b>',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      } as never
      doc.nodes[column].children = [
        ...(doc.nodes[column].children ?? []),
        'html1',
      ]
      expectErr(
        await Service.update(...A, 'is1', { builderDocument: doc as never }),
        'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
      )
      member(true)
      expectOk(
        await Service.update(...A, 'is1', { builderDocument: doc as never }),
      )
    })
  })

  describe('remove', () => {
    it('deletes drafts only', async () => {
      withIssue({ status: 'SCHEDULED' })
      expectErr(
        await Service.remove(...A, 'is1', NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      withIssue()
      issues.softDeleteDraft.mockResolvedValueOnce(ok(true))
      expectOk(await Service.remove(...A, 'is1', NOW))
      issues.softDeleteDraft.mockResolvedValueOnce(ok(false))
      expectErr(
        await Service.remove(...A, 'is1', NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      issues.softDeleteDraft.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.remove(...A, 'is1', NOW))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.remove(...A, 'is1', NOW), 'FORBIDDEN')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.remove(...A, 'is1', NOW))
    })
  })

  describe('testSend', () => {
    const dto = {
      emails: ['Ana@acme.com.br', 'ana@acme.com.br', 'b@acme.com.br'],
    }

    it('sends to unique addresses from the newsletter sender', async () => {
      withIssue()
      issues.findNewsletter.mockResolvedValue(
        ok(createFakeNewsletter({ replyTo: 'r@acme.com.br' })),
      )
      const result = expectOk(await Service.testSend(...A, 'is1', dto))
      expect(result.to).toEqual(['ana@acme.com.br', 'b@acme.com.br'])
      expect(sendEmail).toHaveBeenCalledTimes(2)
      expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({
        from: '"Acme" <news@news.acme.com.br>',
        subject: '[Teste] S',
        replyTo: 'r@acme.com.br',
      })
      expect(consume).toHaveBeenCalledWith({}, 'issue:is1')
    })

    it('falls back to the Steel sender while the domain is unverified', async () => {
      withIssue()
      vi.mocked(resolveVerifiedSender).mockResolvedValueOnce(
        err(sendingDomainNotVerified()),
      )
      expectOk(
        await Service.testSend(...A, 'is1', { emails: ['a@acme.com.br'] }),
      )
      expect(vi.mocked(sendEmail).mock.calls[0][0].from).toContain('steel')
      expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty(
        'replyTo',
      )
    })

    it('is rate limited, needs a valid document and reports mail errors', async () => {
      withIssue()
      vi.mocked(consume).mockResolvedValueOnce(err(rateLimited(60)))
      expectErr(await Service.testSend(...A, 'is1', dto), 'RATE_LIMITED')
      vi.mocked(renderIssueBase).mockResolvedValueOnce(
        err(crmEmailCanvasInvalid(['x'])),
      )
      expectErr(await Service.testSend(...A, 'is1', dto))
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error('boom'))
      expectErr(await Service.testSend(...A, 'is1', dto), 'MAIL_ERROR')
      vi.mocked(sendEmail).mockRejectedValueOnce('weird')
      expectErr(await Service.testSend(...A, 'is1', dto), 'MAIL_ERROR')
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.testSend(...A, 'is1', dto), 'FORBIDDEN')
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.testSend(...A, 'is1', dto))
    })
  })

  describe('preflight', () => {
    it('is ready when every check passes', async () => {
      withIssue()
      issues.countAudience.mockResolvedValue(ok(10))
      const result = expectOk(await Service.preflight(...A, 'is1', NOW))
      expect(result).toMatchObject({
        audience: 10,
        remaining: 3000,
        senderVerified: true,
        blockers: [],
      })
    })

    it('lists every blocker in the send order', async () => {
      withIssue()
      issues.findNewsletter.mockResolvedValue(
        ok(createFakeNewsletter({ status: 'ARCHIVED' })),
      )
      vi.mocked(resolveVerifiedSender).mockResolvedValue(
        err(sendingDomainNotVerified('Domínio não verificado')),
      )
      vi.mocked(issueChecklist).mockReturnValueOnce([
        { code: 'SUBJECT_EMPTY', level: 'error', message: 'Sem assunto' },
        { code: 'PREHEADER_EMPTY', level: 'warning', message: 'Sem pré' },
      ])
      issues.countAudience.mockResolvedValue(ok(0))
      const result = expectOk(await Service.preflight(...A, 'is1', NOW))
      expect(result.blockers.map((b) => b.code)).toEqual([
        'NEWSLETTER_ARCHIVED',
        'SENDER_NOT_VERIFIED',
        'CONTENT_INVALID',
        'NO_SUBSCRIBERS',
      ])
      expect(result.checklist).toHaveLength(2)
      expect(result.senderVerified).toBe(false)
    })

    it('flags the quota with numbers and invalid documents', async () => {
      withIssue()
      issues.countAudience.mockResolvedValue(ok(500))
      usage.getUsage.mockResolvedValue(
        ok({
          month: '2026-10',
          emailsSent: 2800,
          limit: 3000,
          limitSource: 'PLAN',
        }),
      )
      vi.mocked(renderIssueBase).mockResolvedValueOnce(
        err(crmNewsletterIssueIncomplete('Rodapé ausente')),
      )
      const result = expectOk(await Service.preflight(...A, 'is1', NOW))
      expect(result.blockers).toEqual([
        { code: 'CONTENT_INVALID', message: 'Rodapé ausente' },
        {
          code: 'LIMIT_REACHED',
          message: limitMessage(500, 200, 3000),
        },
      ])
      expect(result.blockers[1].message).toContain('restam 200 de 3.000')
    })

    it('propagates failures', async () => {
      withIssue()
      issues.countAudience.mockResolvedValue(ok(1))
      vi.mocked(resolveVerifiedSender).mockResolvedValueOnce(
        err(databaseError()),
      )
      expectErr(await Service.preflight(...A, 'is1', NOW), 'DATABASE_ERROR')
      issues.countAudience.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.preflight(...A, 'is1', NOW))
      usage.getUsage.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.preflight(...A, 'is1', NOW))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.preflight(...A, 'is1', NOW))
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.preflight(...A, 'is1', NOW))
      expect(limitMessage(1, 0, null)).toContain('de 0 e-mails')
    })
  })

  describe('report, recipients, trend and summary', () => {
    it('returns the funnel (zeros before sending) and the links', async () => {
      withIssue()
      deliveries.linkStats.mockResolvedValue(
        ok([{ url: 'https://a', clicks: 2, uniqueClickers: 1 }]),
      )
      const empty = expectOk(await Service.report(...A, 'is1'))
      expect(empty.stats.sent).toBe(0)
      expect(empty.links).toHaveLength(1)
      const stats = {
        recipients: 1,
        sent: 1,
        skipped: 0,
        failed: 0,
        delivered: 1,
        opened: 1,
        clicked: 0,
        bounced: 0,
        complained: 0,
        unsubscribed: 0,
      }
      deliveries.statsFor.mockResolvedValueOnce(ok(new Map([['is1', stats]])))
      expect(expectOk(await Service.report(...A, 'is1')).stats).toEqual(stats)
      deliveries.statsFor.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, 'is1'))
      deliveries.linkStats.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, 'is1'))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.report(...A, 'is1'))
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.report(...A, 'is1'))
    })

    it('pages the recipients', async () => {
      withIssue()
      deliveries.listRecipients.mockResolvedValue(
        ok({ items: [createFakeNewsletterRecipient()], total: 1 }),
      )
      const query = { page: 1, pageSize: 25, filter: 'all' as const }
      const page = expectOk(await Service.recipients(...A, 'is1', query))
      expect(page.items[0].email).toBe('ana@example.com')
      deliveries.listRecipients.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.recipients(...A, 'is1', query))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.recipients(...A, 'is1', query))
      issues.findById.mockResolvedValueOnce(ok(null))
      expectErr(await Service.recipients(...A, 'is1', query))
    })

    it('builds the trend of the last sent issues', async () => {
      issues.listLastSent.mockResolvedValue(
        ok([createFakeNewsletterIssue({ status: 'SENT' })]),
      )
      expect(expectOk(await Service.trend(...A)).issues).toHaveLength(1)
      deliveries.statsFor.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.trend(...A))
      issues.listLastSent.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.trend(...A))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.trend(...A))
    })

    it('summarizes the newsletter for the issue screens', async () => {
      expect(expectOk(await Service.summary(...A))).toEqual({
        id: 'nl1',
        name: 'Novidades Acme',
        senderVerified: true,
        archived: false,
      })
      vi.mocked(resolveVerifiedSender).mockResolvedValueOnce(
        err(sendingDomainNotVerified()),
      )
      expect(expectOk(await Service.summary(...A)).senderVerified).toBe(false)
      vi.mocked(resolveVerifiedSender).mockResolvedValueOnce(
        err(databaseError()),
      )
      expectErr(await Service.summary(...A))
      authz.mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.summary(...A))
    })
  })
})
