import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailBuilderTemplate,
  createFakeCrmEmailTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmEmailBuilderStructureLocked, databaseError } from '@/src/errors'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock('@/src/services/crm-email-builder.service', () => ({
  buildBuilderTemplateContent: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { buildBuilderTemplateContent } from '../crm-email-builder.service'
import { CrmEmailTemplateService } from '../crm-email-template.service'

const mockedMembership = vi.mocked(MembershipRepository)
const mockedRepo = vi.mocked(CrmEmailTemplateRepository)
const mockedBuild = vi.mocked(buildBuilderTemplateContent)
const mockedAudit = vi.mocked(auditMutation)

const built = (layout: 'newsletter' | 'promocao' = 'newsletter') => ({
  document: createBuilderDocument(layout),
  html: '<html>{{unsubscribe_url}}</html>',
  text: 'Descadastrar {{unsubscribe_url}}',
})

beforeEach(() => {
  mockedMembership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
})

describe('CrmEmailTemplateService with the visual builder', () => {
  describe('create() with builderLayout', () => {
    it('creates a BUILDER template from the layout defaults', async () => {
      mockedBuild.mockResolvedValueOnce(ok(built('promocao')))
      const template = createFakeCrmEmailBuilderTemplate('promocao')
      mockedRepo.create.mockResolvedValueOnce(ok(template))

      const dto = expectOk(
        await CrmEmailTemplateService.create('u1', 'ws1', {
          name: 'Promo',
          subject: 'Oferta',
          builderLayout: 'promocao',
        }),
      )
      expect(dto.kind).toBe('BUILDER')
      expect(mockedBuild).toHaveBeenCalledWith(
        'ws1',
        createBuilderDocument('promocao'),
        'Oferta',
        { privileged: false },
      )
      expect(mockedRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'BUILDER',
          builderDocument: createBuilderDocument('promocao'),
          contentHtml: '<html>{{unsubscribe_url}}</html>',
          contentText: 'Descadastrar {{unsubscribe_url}}',
        }),
      )
    })

    it('propagates render failures', async () => {
      mockedBuild.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmEmailTemplateService.create('u1', 'ws1', {
          name: 'Promo',
          subject: 'Oferta',
          builderLayout: 'promocao',
        }),
        'DATABASE_ERROR',
      )
      expect(mockedRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('getById()', () => {
    it('returns the template of the workspace', async () => {
      mockedRepo.findById.mockResolvedValueOnce(
        ok(createFakeCrmEmailBuilderTemplate('newsletter', { id: 't1' })),
      )
      expect(
        expectOk(await CrmEmailTemplateService.getById('u1', 'ws1', 't1')).id,
      ).toBe('t1')
      expect(mockedRepo.findById).toHaveBeenCalledWith('t1', 'ws1')
    })

    it('returns FORBIDDEN for a non-member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmEmailTemplateService.getById('u1', 'ws1', 't1'),
        'FORBIDDEN',
      )
    })

    it('propagates NOT_FOUND', async () => {
      mockedRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmEmailTemplateService.getById('u1', 'ws1', 't1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('update() with builderDocument', () => {
    it('saves the sanitized document and the new render (autosave)', async () => {
      const existing = createFakeCrmEmailBuilderTemplate('newsletter', {
        id: 't1',
        subject: 'Antigo',
      })
      mockedRepo.findById.mockResolvedValueOnce(ok(existing))
      mockedBuild.mockResolvedValueOnce(ok(built()))
      mockedRepo.update.mockResolvedValueOnce(ok(existing))

      const doc = createBuilderDocument('newsletter')
      expectOk(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          builderDocument: doc,
        }),
      )
      expect(mockedBuild).toHaveBeenCalledWith('ws1', doc, 'Antigo', {
        privileged: false,
        previous: existing.builderDocument,
      })
      expect(mockedRepo.update).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          builderDocument: built().document,
          contentHtml: built().html,
          contentText: built().text,
          updatedById: 'u1',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update', targetId: 't1' }),
      )
    })

    it('re-renders the stored document when only the subject changes', async () => {
      const existing = createFakeCrmEmailBuilderTemplate('newsletter', {
        id: 't1',
      })
      mockedRepo.findById.mockResolvedValueOnce(ok(existing))
      mockedBuild.mockResolvedValueOnce(ok(built()))
      mockedRepo.update.mockResolvedValueOnce(ok(existing))
      expectOk(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          subject: 'Novo',
        }),
      )
      expect(mockedBuild).toHaveBeenCalledWith(
        'ws1',
        createBuilderDocument('newsletter'),
        'Novo',
        { privileged: false, previous: existing.builderDocument },
      )
    })

    it('renames a builder template without re-rendering', async () => {
      const existing = createFakeCrmEmailBuilderTemplate('newsletter', {
        id: 't1',
      })
      mockedRepo.findById.mockResolvedValueOnce(ok(existing))
      mockedRepo.update.mockResolvedValueOnce(ok(existing))
      expectOk(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          name: 'Outro nome',
        }),
      )
      expect(mockedBuild).not.toHaveBeenCalled()
    })

    it('rejects a document for a legacy template', async () => {
      mockedRepo.findById.mockResolvedValueOnce(
        ok(createFakeCrmEmailTemplate({ id: 't1' })),
      )
      expectErr(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          builderDocument: createBuilderDocument('newsletter'),
        }),
        'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
      )
      expect(mockedRepo.update).not.toHaveBeenCalled()
    })

    it('rejects switching the layout of a builder template', async () => {
      mockedRepo.findById.mockResolvedValueOnce(
        ok(createFakeCrmEmailBuilderTemplate('newsletter', { id: 't1' })),
      )
      expectErr(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          builderDocument: createBuilderDocument('promocao'),
        }),
        'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
      )
    })

    it('rejects free HTML edits on a builder template', async () => {
      mockedRepo.findById.mockResolvedValueOnce(
        ok(createFakeCrmEmailBuilderTemplate('newsletter', { id: 't1' })),
      )
      expectErr(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          contentHtml: '<p>livre</p>',
        }),
        'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
      )
    })

    it('propagates structure violations from the renderer', async () => {
      mockedRepo.findById.mockResolvedValueOnce(
        ok(createFakeCrmEmailBuilderTemplate('newsletter', { id: 't1' })),
      )
      mockedBuild.mockResolvedValueOnce(err(crmEmailBuilderStructureLocked()))
      expectErr(
        await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
          builderDocument: createBuilderDocument('newsletter'),
        }),
        'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
      )
    })
  })
})
