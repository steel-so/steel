import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeNewsletter } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { createFakeWelcomeStep } from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueIncomplete,
  databaseError,
  forbidden,
  notFound,
} from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
}))
vi.mock('@/src/repositories/crm-newsletter-welcome.repository')
vi.mock('@/src/repositories/crm-email-template.repository', () => ({
  CrmEmailTemplateRepository: { findById: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-render', () => ({
  validateIssueDocument: vi.fn(),
}))
vi.mock('@/src/lib/canvas-email/validate', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  changesHtmlBlocks: vi.fn(() => false),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { changesHtmlBlocks } from '@/src/lib/canvas-email/validate'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmNewsletterWelcomeRepository } from '@/src/repositories/crm-newsletter-welcome.repository'
import { loadNewsletterScope } from '../crm-newsletter-issue.service'
import { validateIssueDocument } from '../crm-newsletter-render'
import {
  documentPreheader,
  CrmNewsletterWelcomeService as Service,
  withPreheader,
} from '../crm-newsletter-welcome.service'

const repo = vi.mocked(CrmNewsletterWelcomeRepository)
const scope = vi.mocked(loadNewsletterScope)
const templates = vi.mocked(CrmEmailTemplateRepository)
const validate = vi.mocked(validateIssueDocument)
const html = vi.mocked(changesHtmlBlocks)
const A = ['u1', 'ws1', 'nl1'] as const

function allow(options: { privileged?: boolean; archived?: boolean } = {}) {
  scope.mockResolvedValue(
    ok({
      membership: {
        role: options.privileged ? 'ADMIN' : 'MEMBER',
        isPrivileged: Boolean(options.privileged),
        permissions: null,
      },
      newsletter: createFakeNewsletter(
        options.archived ? { status: 'ARCHIVED' } : {},
      ),
    }) as never,
  )
}

describe('preheader helpers', () => {
  it('reads and writes the root preheader', () => {
    const doc = createBlankEmailDocument()
    expect(documentPreheader(doc)).toBe('')
    const next = withPreheader(doc, 'Oi')
    expect(documentPreheader(next)).toBe('Oi')
    expect(documentPreheader('nope')).toBe('')
    const root = doc.nodes[doc.rootId]
    expect(
      documentPreheader({
        ...doc,
        nodes: { ...doc.nodes, [doc.rootId]: { ...root, props: undefined } },
      }),
    ).toBe('')
    expect(withPreheader('nope', 'x')).toBe('nope')
  })
})

describe('CrmNewsletterWelcomeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allow()
  })

  it('propagates the scope denial everywhere', async () => {
    scope.mockResolvedValue(err(forbidden()))
    expectErr(await Service.list(...A), 'FORBIDDEN')
    expectErr(await Service.get(...A, 'st1'), 'FORBIDDEN')
    expectErr(
      await Service.create(...A, {
        subject: 'Oi',
        delayValue: 0,
        delayUnit: 'DAYS',
      }),
      'FORBIDDEN',
    )
    expectErr(await Service.update(...A, 'st1', { enabled: true }), 'FORBIDDEN')
    expectErr(await Service.remove(...A, 'st1'), 'FORBIDDEN')
    expectErr(await Service.reorder(...A, { ids: ['st1'] }), 'FORBIDDEN')
    expect(repo.listSteps).not.toHaveBeenCalled()
  })

  it('lists the steps with their stats', async () => {
    repo.listSteps.mockResolvedValue(
      ok([createFakeWelcomeStep(), createFakeWelcomeStep({ id: 'st2' })]),
    )
    repo.statsFor.mockResolvedValue(
      ok(new Map([['st1', { sent: 3, opened: 2, clicked: 1 }]])),
    )
    const list = expectOk(await Service.list(...A))
    expect(list.map((step) => step.stats)).toEqual([
      { sent: 3, opened: 2, clicked: 1 },
      { sent: 0, opened: 0, clicked: 0 },
    ])
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'VIEW')

    repo.statsFor.mockResolvedValue(err(databaseError()))
    expectErr(await Service.list(...A), 'DATABASE_ERROR')
    repo.listSteps.mockResolvedValue(err(databaseError()))
    expectErr(await Service.list(...A), 'DATABASE_ERROR')
  })

  it('gets one step with its document, or not found', async () => {
    repo.findStep.mockResolvedValue(ok(createFakeWelcomeStep()))
    repo.statsFor.mockResolvedValue(ok(new Map()))
    const step = expectOk(await Service.get(...A, 'st1'))
    expect(step.builderDocument).toBeDefined()

    repo.statsFor.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, 'st1'), 'DATABASE_ERROR')
    repo.findStep.mockResolvedValue(ok(null))
    expectErr(
      await Service.get(...A, 'st1'),
      'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
    )
    repo.findStep.mockResolvedValue(err(databaseError()))
    expectErr(await Service.get(...A, 'st1'), 'DATABASE_ERROR')
  })

  describe('create', () => {
    const dto = { subject: 'Oi', delayValue: 2, delayUnit: 'DAYS' as const }

    beforeEach(() => {
      repo.countSteps.mockResolvedValue(ok(1))
      repo.createStep.mockImplementation(async (input) =>
        ok(
          createFakeWelcomeStep({
            subject: input.subject,
            preheader: input.preheader,
            builderDocument: input.builderDocument as never,
          }),
        ),
      )
    })

    it('starts from a blank e-mail and audits', async () => {
      const step = expectOk(await Service.create(...A, dto))
      expect(step.subject).toBe('Oi')
      expect(repo.createStep).toHaveBeenCalledWith(
        expect.objectContaining({
          newsletterId: 'nl1',
          workspaceId: 'ws1',
          delayValue: 2,
          delayUnit: 'DAYS',
          preheader: null,
          createdById: 'u1',
        }),
      )
      expect(templates.findById).not.toHaveBeenCalled()
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'crm_newsletter', action: 'update' }),
      )
      expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'CREATE')
    })

    it('starts from the newsletter template and writes the preheader', async () => {
      scope.mockResolvedValue(
        ok({
          membership: { isPrivileged: false },
          newsletter: createFakeNewsletter({ templateId: 't1' }),
        }) as never,
      )
      templates.findById.mockResolvedValue(
        ok({ builderDocument: createBlankEmailDocument() }) as never,
      )
      expectOk(await Service.create(...A, { ...dto, preheader: 'Olá' }))
      const input = repo.createStep.mock.calls[0][0]
      expect(input.preheader).toBe('Olá')
      expect(documentPreheader(input.builderDocument)).toBe('Olá')

      // A template that is gone (or not a canvas) falls back to blank.
      templates.findById.mockResolvedValue(err(notFound('Template')))
      expectOk(await Service.create(...A, dto))
      templates.findById.mockResolvedValue(
        ok({ builderDocument: null }) as never,
      )
      expectOk(await Service.create(...A, dto))
    })

    it('refuses archived newsletters, a full series and DB errors', async () => {
      allow({ archived: true })
      expectErr(await Service.create(...A, dto), 'CRM_NEWSLETTER_ARCHIVED')
      allow()
      repo.countSteps.mockResolvedValue(ok(10))
      expectErr(
        await Service.create(...A, dto),
        'CRM_NEWSLETTER_WELCOME_STEP_LIMIT_REACHED',
      )
      repo.countSteps.mockResolvedValue(err(databaseError()))
      expectErr(await Service.create(...A, dto), 'DATABASE_ERROR')
      repo.countSteps.mockResolvedValue(ok(0))
      repo.createStep.mockResolvedValue(err(databaseError()))
      expectErr(await Service.create(...A, dto), 'DATABASE_ERROR')
    })
  })

  describe('update', () => {
    beforeEach(() => {
      repo.findStep.mockResolvedValue(ok(createFakeWelcomeStep()))
      repo.updateStep.mockImplementation(async (_id, data) =>
        ok(createFakeWelcomeStep(data as never)),
      )
      validate.mockImplementation((doc) => ok(doc as never))
    })

    it('saves fields and audits switching on/off', async () => {
      const step = expectOk(
        await Service.update(...A, 'st1', {
          subject: 'Novo',
          delayValue: 6,
          delayUnit: 'HOURS',
          enabled: false,
        }),
      )
      expect(step).toMatchObject({
        subject: 'Novo',
        delayValue: 6,
        delayUnit: 'HOURS',
        enabled: false,
      })
      expect(auditMutation).toHaveBeenCalledTimes(1)
      expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'EDIT')

      vi.mocked(auditMutation).mockClear()
      expectOk(await Service.update(...A, 'st1', { enabled: true }))
      expect(auditMutation).not.toHaveBeenCalled()

      repo.findStep.mockResolvedValue(
        ok(createFakeWelcomeStep({ enabled: false })),
      )
      expectOk(await Service.update(...A, 'st1', { enabled: true }))
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ op: 'enable' }),
        }),
      )
    })

    it('keeps the preheader column and the document in sync', async () => {
      const doc = createBlankEmailDocument()
      expectOk(
        await Service.update(...A, 'st1', {
          builderDocument: withPreheader(doc, 'Do doc') as never,
        }),
      )
      expect(repo.updateStep.mock.calls[0][1]).toMatchObject({
        preheader: 'Do doc',
      })

      expectOk(
        await Service.update(...A, 'st1', {
          builderDocument: doc as never,
          preheader: 'Junto',
        }),
      )
      expect(repo.updateStep.mock.calls[1][1]).toMatchObject({
        preheader: 'Junto',
      })

      expectOk(
        await Service.update(...A, 'st1', {
          builderDocument: doc as never,
          preheader: null,
        }),
      )
      expect(repo.updateStep.mock.calls[2][1]).toMatchObject({
        preheader: null,
      })

      expectOk(await Service.update(...A, 'st1', { preheader: 'Só ele' }))
      const call = repo.updateStep.mock.calls[3][1]
      expect(call.preheader).toBe('Só ele')
      expect(documentPreheader(call.builderDocument)).toBe('Só ele')

      expectOk(await Service.update(...A, 'st1', { preheader: null }))
      expect(
        documentPreheader(repo.updateStep.mock.calls[4][1].builderDocument),
      ).toBe('')
    })

    it('refuses invalid documents and HTML changes by members', async () => {
      validate.mockReturnValue(err(crmNewsletterIssueIncomplete('ruim')))
      expectErr(
        await Service.update(...A, 'st1', { builderDocument: {} as never }),
        'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      )
      validate.mockImplementation((doc) => ok(doc as never))
      html.mockReturnValue(true)
      expectErr(
        await Service.update(...A, 'st1', {
          builderDocument: createBlankEmailDocument() as never,
        }),
        'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
      )
      allow({ privileged: true })
      expectOk(
        await Service.update(...A, 'st1', {
          builderDocument: createBlankEmailDocument() as never,
        }),
      )
      html.mockReturnValue(false)
    })

    it('returns not found and DB errors', async () => {
      repo.updateStep.mockResolvedValue(err(databaseError()))
      expectErr(
        await Service.update(...A, 'st1', { subject: 'x' }),
        'DATABASE_ERROR',
      )
      repo.findStep.mockResolvedValue(ok(null))
      expectErr(
        await Service.update(...A, 'st1', { subject: 'x' }),
        'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
      )
    })
  })

  it('removes a step (audited)', async () => {
    repo.findStep.mockResolvedValue(ok(createFakeWelcomeStep()))
    repo.deleteStep.mockResolvedValue(ok(undefined))
    expectOk(await Service.remove(...A, 'st1'))
    expect(repo.deleteStep).toHaveBeenCalledWith('nl1', 'st1')
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'DELETE')
    expect(auditMutation).toHaveBeenCalled()

    repo.deleteStep.mockResolvedValue(err(databaseError()))
    expectErr(await Service.remove(...A, 'st1'), 'DATABASE_ERROR')
    repo.findStep.mockResolvedValue(ok(null))
    expectErr(
      await Service.remove(...A, 'st1'),
      'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
    )
  })

  it('reorders only with every step once', async () => {
    const steps = [
      createFakeWelcomeStep({ id: 'a' }),
      createFakeWelcomeStep({ id: 'b' }),
    ]
    repo.listSteps.mockResolvedValue(ok(steps))
    repo.statsFor.mockResolvedValue(ok(new Map()))
    repo.reorderSteps.mockResolvedValue(ok(undefined))
    expectOk(await Service.reorder(...A, { ids: ['b', 'a'] }))
    expect(repo.reorderSteps).toHaveBeenCalledWith(['b', 'a'])

    expectErr(await Service.reorder(...A, { ids: ['a'] }), 'VALIDATION_ERROR')
    expectErr(
      await Service.reorder(...A, { ids: ['a', 'x'] }),
      'VALIDATION_ERROR',
    )
    repo.reorderSteps.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.reorder(...A, { ids: ['a', 'b'] }),
      'DATABASE_ERROR',
    )
    repo.listSteps.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.reorder(...A, { ids: ['a', 'b'] }),
      'DATABASE_ERROR',
    )
  })
})
