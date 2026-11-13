import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeDocument,
  createFakeDocumentFull,
  createFakeDocumentVersion,
  sampleDocumentContent,
} from '@/src/__tests__/factories/document-backend.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { documentNotFound } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/repositories/document-event.repository')
vi.mock('@/src/repositories/document-response.repository')
vi.mock('@/src/repositories/document-version.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/services/crm-settings.service', () => ({
  CrmSettingsService: { resolve: vi.fn() },
}))
vi.mock('@/src/lib/canvas-document/catalog', () => ({
  validateDocumentContent: vi.fn(),
  createEmptyDocumentContent: vi.fn(),
}))
vi.mock('@/src/lib/canvas-document/starters', () => ({
  getDocumentStarter: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  createEmptyDocumentContent,
  validateDocumentContent,
} from '@/src/lib/canvas-document/catalog'
import { getDocumentStarter } from '@/src/lib/canvas-document/starters'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentEventRepository } from '@/src/repositories/document-event.repository'
import { DocumentResponseRepository } from '@/src/repositories/document-response.repository'
import { DocumentVersionRepository } from '@/src/repositories/document-version.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmSettingsService } from '../crm-settings.service'
import { DocumentService } from '../document.service'

const membershipRepo = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const documentRepo = vi.mocked(DocumentRepository)
const eventRepo = vi.mocked(DocumentEventRepository)
const responseRepo = vi.mocked(DocumentResponseRepository)
const versionRepo = vi.mocked(DocumentVersionRepository)
const companyRepo = vi.mocked(CrmCompanyRepository)
const personRepo = vi.mocked(CrmPersonRepository)
const opportunityRepo = vi.mocked(CrmOpportunityRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const settings = vi.mocked(CrmSettingsService)
const validate = vi.mocked(validateDocumentContent)
const emptyContent = vi.mocked(createEmptyDocumentContent)
const starter = vi.mocked(getDocumentStarter)
const audit = vi.mocked(auditMutation)

const DAY_MS = 86_400_000
const LIST_QUERY = { isTemplate: false, page: 1, pageSize: 25 }

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const META = {
  id: 'd1',
  workspaceId: 'ws1',
  status: 'DRAFT' as const,
  isTemplate: false,
  updatedAt: new Date(),
  currentVersionId: null,
}

beforeEach(() => {
  asRole('MEMBER')
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  validate.mockImplementation((content) => ok(content as CanvasDocument))
  emptyContent.mockReturnValue(sampleDocumentContent({ empty: true }))
  documentRepo.create.mockImplementation(async (data) =>
    ok(createFakeDocumentFull({ id: 'new', kind: data.kind ?? 'OTHER' })),
  )
  documentRepo.update.mockResolvedValue(ok(createFakeDocumentFull()))
  documentRepo.findMeta.mockResolvedValue(ok(META))
  eventRepo.createMany.mockResolvedValue(ok(1))
  settings.resolve.mockResolvedValue(
    ok({
      leadReopenStage: null,
      proposalValidityDays: 15,
      notifyProposalExpiry: true,
    } as never),
  )
})

describe('DocumentService — authorization', () => {
  it('refuses a non-member', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await DocumentService.list('u1', 'ws1', LIST_QUERY), 'FORBIDDEN')
    expect(documentRepo.list).not.toHaveBeenCalled()
  })

  it('refuses when the CRM module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await DocumentService.get('u1', 'ws1', 'd1'), 'MODULE_DISABLED')
  })

  it('lets a VIEWER read but not create, edit or delete', async () => {
    asRole('VIEWER')
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    expectOk(await DocumentService.get('u1', 'ws1', 'd1'))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
      }),
      'FORBIDDEN',
    )
    expectErr(
      await DocumentService.saveContent('u1', 'ws1', 'd1', {
        content: {},
      }),
      'FORBIDDEN',
    )
  })

  it('lets only OWNER/ADMIN delete', async () => {
    expectErr(await DocumentService.remove('u1', 'ws1', 'd1'), 'FORBIDDEN')
    asRole('ADMIN')
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    documentRepo.softDelete.mockResolvedValue(ok(undefined))
    expectOk(await DocumentService.remove('u1', 'ws1', 'd1'))
    expect(documentRepo.softDelete).toHaveBeenCalledWith('d1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'document', action: 'delete' }),
    )
  })

  it('does not reach a document of another workspace', async () => {
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.get('u1', 'ws-other', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
    expect(documentRepo.findById).toHaveBeenCalledWith('d1', 'ws-other')
  })
})

describe('DocumentService.list()', () => {
  it('returns the page with the DTOs', async () => {
    documentRepo.list.mockResolvedValue(
      ok({ items: [createFakeDocumentFull({ id: 'a' })], total: 1 }),
    )
    const page = expectOk(
      await DocumentService.list('u1', 'ws1', { ...LIST_QUERY, page: 2 }),
    )
    expect(page.items.map((item) => item.id)).toEqual(['a'])
    expect(page).toMatchObject({ total: 1, page: 2, pageSize: 25 })
  })

  it('propagates database errors', async () => {
    documentRepo.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.list('u1', 'ws1', LIST_QUERY),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentService.create()', () => {
  it('creates a blank document with a random token and a CREATED event', async () => {
    const created = expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Contrato',
        kind: 'CONTRACT',
        isTemplate: false,
      }),
    )
    expect(created.id).toBe('new')
    const data = documentRepo.create.mock.calls[0][0]
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      title: 'Contrato',
      kind: 'CONTRACT',
      source: 'BLANK',
      ownerId: 'u1',
      createdById: 'u1',
      validUntil: null,
    })
    expect(String(data.publicToken)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(eventRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'CREATED', documentId: 'new' }),
    ])
    expect(settings.resolve).not.toHaveBeenCalled()
  })

  it('gives a proposal the default validity of the CRM', async () => {
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Proposta',
        kind: 'PROPOSAL',
        isTemplate: false,
      }),
    )
    const data = documentRepo.create.mock.calls[0][0]
    const validUntil = data.validUntil as Date
    expect(validUntil.getTime()).toBeGreaterThan(Date.now() + 14 * DAY_MS)
  })

  it('propagates a failure resolving the CRM settings', async () => {
    settings.resolve.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'Proposta',
        kind: 'PROPOSAL',
        isTemplate: false,
      }),
      'DATABASE_ERROR',
    )
  })

  it('keeps an explicit validity and never sets one on a template', async () => {
    const validUntil = new Date(Date.now() + 5 * DAY_MS)
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Modelo',
        kind: 'PROPOSAL',
        isTemplate: true,
        validUntil,
      }),
    )
    expect(documentRepo.create.mock.calls[0][0].validUntil).toBeNull()
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Doc',
        kind: 'PROPOSAL',
        isTemplate: false,
        validUntil,
      }),
    )
    expect(documentRepo.create.mock.calls[1][0].validUntil).toBe(validUntil)
  })

  it('copies a template (content, theme, settings and kind)', async () => {
    documentRepo.findTemplate.mockResolvedValue(
      ok(
        createFakeDocument({
          id: 'tpl',
          isTemplate: true,
          kind: 'QUOTE',
          theme: { primaryColor: '#123456' },
        }),
      ),
    )
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Orçamento',
        kind: 'OTHER',
        isTemplate: false,
        templateId: 'tpl',
      }),
    )
    expect(documentRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'QUOTE',
      source: 'TEMPLATE',
      templateId: 'tpl',
      theme: { primaryColor: '#123456' },
    })
  })

  it('keeps the kind chosen over the template one', async () => {
    documentRepo.findTemplate.mockResolvedValue(
      ok(createFakeDocument({ id: 'tpl', isTemplate: true, kind: 'QUOTE' })),
    )
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Contrato',
        kind: 'CONTRACT',
        isTemplate: false,
        templateId: 'tpl',
      }),
    )
    expect(documentRepo.create.mock.calls[0][0].kind).toBe('CONTRACT')
  })

  it('refuses an unknown template', async () => {
    documentRepo.findTemplate.mockResolvedValue(
      err({ code: 'DOCUMENT_TEMPLATE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        templateId: 'nope',
      }),
      'DOCUMENT_TEMPLATE_NOT_FOUND',
    )
  })

  it('starts from a starter of the gallery', async () => {
    starter.mockReturnValue({
      content: sampleDocumentContent(),
      theme: { fontFamily: 'Geist' },
      meta: {
        id: 'proposal-classic',
        title: 'Proposta',
        description: '',
        kind: 'PROPOSAL',
      },
    })
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Proposta',
        kind: 'OTHER',
        isTemplate: false,
        starterId: 'proposal-classic',
      }),
    )
    expect(documentRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'PROPOSAL',
      source: 'TEMPLATE',
      templateId: null,
      theme: { fontFamily: 'Geist' },
    })
  })

  it('keeps the chosen kind over the starter one', async () => {
    starter.mockReturnValue({
      content: sampleDocumentContent(),
      theme: {},
      meta: { id: 's', title: 'S', description: '', kind: 'PROPOSAL' },
    })
    expectOk(
      await DocumentService.create('u1', 'ws1', {
        title: 'Termo',
        kind: 'TERMS',
        isTemplate: false,
        starterId: 's',
      }),
    )
    expect(documentRepo.create.mock.calls[0][0].kind).toBe('TERMS')
  })

  it('refuses an unknown starter', async () => {
    starter.mockReturnValue(null)
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        starterId: 'nope',
      }),
      'DOCUMENT_TEMPLATE_NOT_FOUND',
    )
  })

  it('refuses content the catalog rejects', async () => {
    validate.mockReturnValue(err('O documento não tem a raiz esperada'))
    const error = expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
      }),
      'DOCUMENT_CONTENT_INVALID',
    )
    expect(error.message).toBe('O documento não tem a raiz esperada')
  })

  it('validates every CRM link inside the workspace', async () => {
    companyRepo.findById.mockResolvedValue(ok({} as never))
    personRepo.findById.mockResolvedValue(ok({} as never))
    opportunityRepo.findById.mockResolvedValue(ok({} as never))
    leadRepo.findById.mockResolvedValue(err(notFound('CrmLead')))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        companyId: 'c1',
        personId: 'p1',
        opportunityId: 'o1',
        leadId: 'l-other',
      }),
      'RESOURCE_NOT_FOUND',
    )
    expect(leadRepo.findById).toHaveBeenCalledWith('l-other', 'ws1')
    expect(documentRepo.create).not.toHaveBeenCalled()
  })

  it('refuses a company, person or opportunity of another workspace', async () => {
    companyRepo.findById.mockResolvedValue(err(notFound('CrmCompany')))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        companyId: 'c-other',
      }),
      'RESOURCE_NOT_FOUND',
    )
    personRepo.findById.mockResolvedValue(err(notFound('CrmPerson')))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        personId: 'p-other',
      }),
      'RESOURCE_NOT_FOUND',
    )
    opportunityRepo.findById.mockResolvedValue(err(notFound('CrmOpportunity')))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        opportunityId: 'o-other',
      }),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('refuses an owner who is not a member', async () => {
    membershipRepo.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
        ownerId: 'stranger',
      }),
      'FORBIDDEN',
    )
  })

  it('audits a failed insert', async () => {
    documentRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.create('u1', 'ws1', {
        title: 'X',
        kind: 'OTHER',
        isTemplate: false,
      }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', action: 'create' }),
    )
  })
})

describe('DocumentService.update()', () => {
  it('merges settings and updates the fields', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ settings: { showToc: true } })),
    )
    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', {
        title: 'Novo',
        settings: { allowDownload: false },
        theme: { primaryColor: '#000000' },
        linkEnabled: false,
      }),
    )
    const data = documentRepo.update.mock.calls[0][1]
    expect(data).toMatchObject({
      title: 'Novo',
      linkEnabled: false,
      updatedById: 'u1',
      theme: { primaryColor: '#000000' },
      settings: { showToc: true, allowDownload: false, layout: 'web' },
    })
    expect(data.status).toBeUndefined()
  })

  it('returns not found for a missing document', async () => {
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', { title: 'X' }),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('refuses a link of another workspace', async () => {
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    companyRepo.findById.mockResolvedValue(err(notFound('CrmCompany')))
    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', { companyId: 'c9' }),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('archives and restores from the history', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ status: 'SENT' })),
    )
    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', { status: 'ARCHIVED' }),
    )
    expect(documentRepo.update.mock.calls[0][1].status).toBe('ARCHIVED')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archive' }),
    )

    const cases: [Parameters<typeof createFakeDocumentFull>[0], string][] = [
      [{}, 'DRAFT'],
      [{ currentVersionId: 'v1', acceptedAt: new Date() }, 'ACCEPTED'],
      [{ currentVersionId: 'v1', declinedAt: new Date() }, 'DECLINED'],
      [{ currentVersionId: 'v1', expiredAt: new Date() }, 'EXPIRED'],
      [{ currentVersionId: 'v1', firstViewedAt: new Date() }, 'VIEWED'],
      [{ currentVersionId: 'v1' }, 'SENT'],
    ]
    for (const [overrides, expected] of cases) {
      documentRepo.update.mockClear()
      documentRepo.findById.mockResolvedValue(
        ok(createFakeDocumentFull({ ...overrides, status: 'ARCHIVED' })),
      )
      expectOk(
        await DocumentService.update('u1', 'ws1', 'd1', { status: 'DRAFT' }),
      )
      expect(documentRepo.update.mock.calls[0][1].status).toBe(expected)
    }
  })

  it('ignores DRAFT on a document that is not archived', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ status: 'SENT' })),
    )
    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', { status: 'DRAFT' }),
    )
    expect(documentRepo.update.mock.calls[0][1].status).toBeUndefined()
  })

  it('changes the validity of an open document for a MEMBER', async () => {
    const validUntil = new Date(Date.now() + 3 * DAY_MS)
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ status: 'SENT' })),
    )
    expectOk(await DocumentService.update('u1', 'ws1', 'd1', { validUntil }))
    expect(documentRepo.update.mock.calls[0][1]).toMatchObject({ validUntil })
  })

  it('re-opens an expired document only for OWNER/ADMIN with a future date', async () => {
    const future = new Date(Date.now() + 3 * DAY_MS)
    const expired = createFakeDocumentFull({
      status: 'EXPIRED',
      validUntil: new Date(Date.now() - 3 * DAY_MS),
      expiredAt: new Date(),
    })
    documentRepo.findById.mockResolvedValue(ok(expired))

    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', { validUntil: future }),
      'FORBIDDEN',
    )

    asRole('ADMIN')
    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', {
        validUntil: new Date(Date.now() - DAY_MS * 2),
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', { validUntil: null }),
      'VALIDATION_ERROR',
    )

    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', { validUntil: future }),
    )
    expect(documentRepo.update.mock.calls[0][1]).toMatchObject({
      status: 'SENT',
      expiredAt: null,
      validUntil: future,
    })

    documentRepo.findById.mockResolvedValue(
      ok({ ...expired, firstViewedAt: new Date() }),
    )
    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', { validUntil: future }),
    )
    expect(documentRepo.update.mock.calls[1][1].status).toBe('VIEWED')
  })

  it('keeps an expired document expired when the validity is unchanged', async () => {
    const validUntil = new Date(Date.now() - 3 * DAY_MS)
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ status: 'EXPIRED', validUntil })),
    )
    expectOk(
      await DocumentService.update('u1', 'ws1', 'd1', {
        validUntil: new Date(validUntil),
      }),
    )
    expect(documentRepo.update.mock.calls[0][1].status).toBeUndefined()
  })

  it('propagates a database error on update', async () => {
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    documentRepo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.update('u1', 'ws1', 'd1', { title: 'X' }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentService.saveContent()', () => {
  const content = sampleDocumentContent() as unknown as Record<string, unknown>

  it('saves and returns the new updatedAt', async () => {
    const at = new Date('2026-11-11T10:00:00.000Z')
    documentRepo.saveContent.mockResolvedValue(ok(at))
    const base = new Date('2026-11-11T09:00:00.000Z')
    expect(
      expectOk(
        await DocumentService.saveContent('u1', 'ws1', 'd1', {
          content,
          theme: { primaryColor: '#111111' },
          baseUpdatedAt: base,
        }),
      ),
    ).toEqual({ updatedAt: at.toISOString() })
    expect(documentRepo.saveContent).toHaveBeenCalledWith('d1', {
      content,
      theme: { primaryColor: '#111111' },
      updatedById: 'u1',
      baseUpdatedAt: base,
    })
  })

  it('answers DOCUMENT_SAVE_CONFLICT on a stale base', async () => {
    documentRepo.saveContent.mockResolvedValue(ok(null))
    expectErr(
      await DocumentService.saveContent('u1', 'ws1', 'd1', {
        content,
        baseUpdatedAt: new Date(),
      }),
      'DOCUMENT_SAVE_CONFLICT',
    )
  })

  it('refuses invalid content and a missing document', async () => {
    validate.mockReturnValue(err('O conteúdo não é de um documento'))
    expectErr(
      await DocumentService.saveContent('u1', 'ws1', 'd1', { content }),
      'DOCUMENT_CONTENT_INVALID',
    )
    documentRepo.findMeta.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.saveContent('u1', 'ws1', 'd1', { content }),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('propagates database errors', async () => {
    documentRepo.saveContent.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.saveContent('u1', 'ws1', 'd1', { content }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentService.duplicate()', () => {
  it('copies a document as a draft owned by the actor', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(
        createFakeDocumentFull({
          id: 'src',
          title: 'Proposta',
          status: 'ACCEPTED',
          companyId: 'c1',
          templateId: 'tpl',
        }),
      ),
    )
    expectOk(await DocumentService.duplicate('u2', 'ws1', 'src', {}))
    expect(documentRepo.create.mock.calls[0][0]).toMatchObject({
      title: 'Cópia de Proposta',
      isTemplate: false,
      source: 'DUPLICATE',
      templateId: 'tpl',
      companyId: 'c1',
      ownerId: 'u2',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'duplicate' }),
    )
  })

  it('saves a document as a template without CRM links', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ id: 'src', title: 'Base', companyId: 'c1' })),
    )
    expectOk(
      await DocumentService.duplicate('u1', 'ws1', 'src', { asTemplate: true }),
    )
    expect(documentRepo.create.mock.calls[0][0]).toMatchObject({
      title: 'Modelo: Base',
      isTemplate: true,
      companyId: null,
      source: 'DUPLICATE',
    })
  })

  it('creates a document from a template with the given title', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ id: 'tpl', isTemplate: true })),
    )
    expectOk(
      await DocumentService.duplicate('u1', 'ws1', 'tpl', {
        asTemplate: false,
        title: 'Para o cliente',
      }),
    )
    expect(documentRepo.create.mock.calls[0][0]).toMatchObject({
      title: 'Para o cliente',
      isTemplate: false,
      source: 'TEMPLATE',
      templateId: 'tpl',
    })
  })

  it('propagates errors', async () => {
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.duplicate('u1', 'ws1', 'x', {}),
      'DOCUMENT_NOT_FOUND',
    )
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    documentRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.duplicate('u1', 'ws1', 'x', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentService.remove()', () => {
  it('propagates not found and database errors', async () => {
    asRole('OWNER')
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.remove('u1', 'ws1', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    documentRepo.softDelete.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentService.remove('u1', 'ws1', 'd1'), 'DATABASE_ERROR')
  })
})

describe('DocumentService sub-resources', () => {
  it('lists versions, events and responses', async () => {
    versionRepo.listByDocument.mockResolvedValue(
      ok([
        {
          ...createFakeDocumentVersion({ id: 'v2', number: 2 }),
          createdBy: null,
        },
      ]),
    )
    eventRepo.listByDocument.mockResolvedValue(
      ok([
        {
          id: 'e1',
          documentId: 'd1',
          workspaceId: 'ws1',
          type: 'CREATED',
          sessionId: null,
          recipientId: null,
          actorId: null,
          data: {},
          createdAt: new Date(),
          recipient: null,
          actor: null,
        },
      ]),
    )
    responseRepo.listByDocument.mockResolvedValue(ok([]))

    const versions = expectOk(
      await DocumentService.listVersions('u1', 'ws1', 'd1'),
    )
    expect(versions.map((version) => version.number)).toEqual([2])
    const events = expectOk(await DocumentService.listEvents('u1', 'ws1', 'd1'))
    expect(events[0].type).toBe('CREATED')
    expect(
      expectOk(await DocumentService.listResponses('u1', 'ws1', 'd1')),
    ).toEqual([])
  })

  it('refuses outsiders and missing documents', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await DocumentService.listVersions('u1', 'ws1', 'd1'),
      'FORBIDDEN',
    )
    expectErr(await DocumentService.listEvents('u1', 'ws1', 'd1'), 'FORBIDDEN')
    expectErr(
      await DocumentService.listResponses('u1', 'ws1', 'd1'),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    documentRepo.findMeta.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentService.listVersions('u1', 'ws1', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
    expectErr(
      await DocumentService.listEvents('u1', 'ws1', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
    expectErr(
      await DocumentService.listResponses('u1', 'ws1', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('propagates database errors of the lists', async () => {
    versionRepo.listByDocument.mockResolvedValue(err(databaseError()))
    eventRepo.listByDocument.mockResolvedValue(err(databaseError()))
    responseRepo.listByDocument.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentService.listVersions('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentService.listEvents('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentService.listResponses('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
  })
})
