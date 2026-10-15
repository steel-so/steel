import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailBuilderTemplate,
  createFakeCrmEmailCanvasTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmEmailCanvasHtmlForbidden } from '@/src/errors'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { err, ok } from '@/src/lib/result'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'

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

const v2 = (layout: 'newsletter' | 'promocao' = 'newsletter') =>
  createEmailDocumentFromLayout(layout) as unknown as EmailCanvasDocument

const built = (document: unknown) => ({
  document: document as EmailCanvasDocument,
  html: '<html>{{unsubscribe_url}}</html>',
  text: 'Descadastrar {{unsubscribe_url}}',
})

function asRole(role: 'MEMBER' | 'ADMIN' | 'OWNER') {
  mockedMembership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => asRole('MEMBER'))

describe('CrmEmailTemplateService with Steel Canvas (v2) documents', () => {
  it('creates a v2 template from a gallery layout', async () => {
    mockedBuild.mockResolvedValueOnce(ok(built(v2('promocao'))))
    mockedRepo.create.mockResolvedValueOnce(
      ok(createFakeCrmEmailCanvasTemplate('promocao')),
    )
    const dto = expectOk(
      await CrmEmailTemplateService.create('u1', 'ws1', {
        name: 'Promo',
        subject: 'Oferta',
        builderLayout: 'promocao',
        builderVersion: 2,
      }),
    )
    expect(dto.builderDocument).toMatchObject({ catalog: 'email', version: 2 })
    expect(mockedBuild).toHaveBeenCalledWith('ws1', v2('promocao'), 'Oferta', {
      privileged: false,
    })
    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'BUILDER',
        builderDocument: v2('promocao'),
      }),
    )
  })

  it('creates a v2 template from a ready document (blank starter)', async () => {
    asRole('OWNER')
    const blank = createBlankEmailDocument() as unknown as EmailCanvasDocument
    mockedBuild.mockResolvedValueOnce(ok(built(blank)))
    mockedRepo.create.mockResolvedValueOnce(
      ok(createFakeCrmEmailCanvasTemplate('newsletter')),
    )
    expectOk(
      await CrmEmailTemplateService.create('u1', 'ws1', {
        name: 'Em branco',
        subject: 'Novidades',
        builderDocument: blank,
        builderLayout: 'promocao',
      }),
    )
    // The document wins over the layout, and the owner may keep HTML blocks.
    expect(mockedBuild).toHaveBeenCalledWith('ws1', blank, 'Novidades', {
      privileged: true,
    })
    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'BUILDER', builderDocument: blank }),
    )
  })

  it('refuses a ready document the build rejects', async () => {
    mockedBuild.mockResolvedValueOnce(err(crmEmailCanvasHtmlForbidden()))
    const result = await CrmEmailTemplateService.create('u1', 'ws1', {
      name: 'Em branco',
      subject: 'Novidades',
      builderDocument:
        createBlankEmailDocument() as unknown as EmailCanvasDocument,
    })
    expect(expectErr(result).code).toBe('CRM_EMAIL_CANVAS_HTML_FORBIDDEN')
    expect(mockedRepo.create).not.toHaveBeenCalled()
  })

  it('saves a v2 document with the member role and the previous document', async () => {
    const existing = createFakeCrmEmailCanvasTemplate('newsletter', {
      id: 't1',
      subject: 'Antigo',
    })
    mockedRepo.findById.mockResolvedValueOnce(ok(existing))
    mockedBuild.mockResolvedValueOnce(ok(built(v2())))
    mockedRepo.update.mockResolvedValueOnce(ok(existing))
    expectOk(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        builderDocument: v2(),
      }),
    )
    expect(mockedBuild).toHaveBeenCalledWith('ws1', v2(), 'Antigo', {
      privileged: false,
      previous: existing.builderDocument,
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: expect.objectContaining({ version: 2 }),
      }),
    )
  })

  it('passes the admin role on (HTML blocks allowed)', async () => {
    asRole('ADMIN')
    const existing = createFakeCrmEmailCanvasTemplate('newsletter', {
      id: 't1',
    })
    mockedRepo.findById.mockResolvedValueOnce(ok(existing))
    mockedBuild.mockResolvedValueOnce(ok(built(v2())))
    mockedRepo.update.mockResolvedValueOnce(ok(existing))
    expectOk(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        builderDocument: v2(),
      }),
    )
    expect(mockedBuild).toHaveBeenCalledWith(
      'ws1',
      v2(),
      expect.any(String),
      expect.objectContaining({ privileged: true }),
    )
  })

  it('upgrades a v1 template to v2', async () => {
    const existing = createFakeCrmEmailBuilderTemplate('newsletter', {
      id: 't1',
    })
    mockedRepo.findById.mockResolvedValueOnce(ok(existing))
    mockedBuild.mockResolvedValueOnce(ok(built(v2())))
    mockedRepo.update.mockResolvedValueOnce(ok(existing))
    expectOk(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        builderDocument: v2('promocao'),
      }),
    )
    expect(mockedRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ builderDocument: v2() }),
    )
  })

  it('never goes back from v2 to v1', async () => {
    mockedRepo.findById.mockResolvedValueOnce(
      ok(createFakeCrmEmailCanvasTemplate('newsletter', { id: 't1' })),
    )
    const error = expectErr(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        builderDocument: createBuilderDocument('newsletter'),
      }),
      'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
    )
    expect(error.message).toContain('novo editor')
    expect(mockedBuild).not.toHaveBeenCalled()
  })

  it('re-renders the stored v2 document on a subject change', async () => {
    const existing = createFakeCrmEmailCanvasTemplate('newsletter', {
      id: 't1',
    })
    mockedRepo.findById.mockResolvedValueOnce(ok(existing))
    mockedBuild.mockResolvedValueOnce(ok(built(v2())))
    mockedRepo.update.mockResolvedValueOnce(ok(existing))
    expectOk(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        subject: 'Novo',
      }),
    )
    expect(mockedBuild).toHaveBeenCalledWith(
      'ws1',
      existing.builderDocument,
      'Novo',
      { privileged: false, previous: existing.builderDocument },
    )
  })

  it('propagates the HTML permission error', async () => {
    mockedRepo.findById.mockResolvedValueOnce(
      ok(createFakeCrmEmailCanvasTemplate('newsletter', { id: 't1' })),
    )
    mockedBuild.mockResolvedValueOnce(err(crmEmailCanvasHtmlForbidden()))
    expectErr(
      await CrmEmailTemplateService.update('u1', 'ws1', 't1', {
        builderDocument: v2(),
      }),
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    )
    expect(mockedRepo.update).not.toHaveBeenCalled()
  })
})
