import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { createFakeCrmSettings } from '@/src/__tests__/factories/crm-settings.factory'
import { createFakeDocument } from '@/src/__tests__/factories/document-migration.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/document-crm.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-settings.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/lib/canvas-document/outline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/canvas-document/outline')>()
  return { ...actual, outlineToDocument: vi.fn() }
})

import { auditMutation } from '@/lib/axiom/audit'
import { outlineToDocument } from '@/src/lib/canvas-document/outline'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { CrmSettingsRepository } from '@/src/repositories/crm-settings.repository'
import { DocumentCrmRepository } from '@/src/repositories/document-crm.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { DocumentCrmService as Service } from '../document-crm.service'

const docs = vi.mocked(DocumentCrmRepository)
const companies = vi.mocked(CrmCompanyRepository)
const people = vi.mocked(CrmPersonRepository)
const leads = vi.mocked(CrmLeadRepository)
const deals = vi.mocked(CrmOpportunityRepository)
const lineItems = vi.mocked(CrmOpportunityLineItemRepository)
const settings = vi.mocked(CrmSettingsRepository)
const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)

const asRole = (role: 'OWNER' | 'MEMBER' | 'VIEWER') =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const CONTENT = { version: 1, rootId: 'root', nodes: {} }

function lineItem(over: Record<string, unknown> = {}) {
  return {
    id: 'li1',
    opportunityId: 'op1',
    productId: 'prod1',
    name: 'Licença',
    quantity: 10,
    unitPrice: new Prisma.Decimal(100),
    discountPct: new Prisma.Decimal(10),
    billingType: 'MONTHLY',
    total: new Prisma.Decimal(900),
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never
}

beforeEach(() => {
  vi.resetAllMocks()
  access.isEnabled.mockResolvedValue(ok(true))
  asRole('MEMBER')
  settings.findByWorkspace.mockResolvedValue(ok(null))
  vi.mocked(outlineToDocument).mockReturnValue({
    content: CONTENT as never,
    theme: {},
  })
  docs.create.mockImplementation(async (data) =>
    ok(
      createFakeDocument({
        id: 'doc1',
        workspaceId: data.workspaceId,
        title: data.title,
        leadId: data.leadId,
        opportunityId: data.opportunityId,
      }),
    ),
  )
})

describe('createProposal', () => {
  it('creates a blank proposal with the default validity and the lead as client', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeCrmSettings({ proposalValidityDays: 30 })),
    )
    leads.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'le1', name: 'Rede Sol' })),
    )

    const dto = expectOk(
      await Service.createProposal('u1', 'ws', {
        title: 'Proposta Rede Sol',
        leadId: 'le1',
      }),
    )

    expect(dto).toMatchObject({ id: 'doc1', path: '/crm/documents/doc1' })
    const data = docs.create.mock.calls[0]?.[0]
    expect(data).toMatchObject({
      workspaceId: 'ws',
      kind: 'PROPOSAL',
      source: 'BLANK',
      templateId: null,
      leadId: 'le1',
      ownerId: 'u1',
      createdById: 'u1',
      totalValue: null,
      content: CONTENT,
    })
    expect(data?.publicToken).toMatch(/^[\w-]{43}$/)
    const days =
      ((data?.validUntil as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThanOrEqual(31)
    expect(vi.mocked(outlineToDocument).mock.calls[0]?.[0]).toMatchObject({
      title: 'Proposta Rede Sol',
      sections: expect.arrayContaining([
        expect.objectContaining({ name: 'Capa' }),
      ]),
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'document', action: 'create' }),
    )
    expect(indexSearchDocument).toHaveBeenCalledWith('crm-document', 'ws', 'doc1')
  })

  it('prices the proposal with the opportunity line items', async () => {
    companies.findById.mockResolvedValue(
      ok(createFakeCrmCompany({ name: 'ACME' })),
    )
    people.findById.mockResolvedValue(ok(createFakeCrmPerson({ name: 'Ana' })))
    deals.findById.mockResolvedValue(ok(createFakeCrmOpportunity()))
    lineItems.listByOpportunity.mockResolvedValue(
      ok([
        lineItem(),
        lineItem({
          id: 'li2',
          productId: null,
          name: 'Setup',
          quantity: 1,
          unitPrice: new Prisma.Decimal(500),
          discountPct: new Prisma.Decimal(0),
          billingType: 'ONE_TIME',
        }),
      ]),
    )
    const validUntil = new Date('2026-12-31T12:00:00.000Z')

    expectOk(
      await Service.createProposal('u1', 'ws', {
        title: 'Proposta ACME',
        companyId: 'co1',
        personId: 'pe1',
        opportunityId: 'op1',
        validUntil,
      }),
    )

    expect(settings.findByWorkspace).not.toHaveBeenCalled()
    const outline = vi.mocked(outlineToDocument).mock.calls[0]?.[0]
    expect(outline?.sections[0]?.blocks[1]).toEqual({
      type: 'text',
      html: '<p>Preparada para ACME</p>',
    })
    const pricing = outline?.sections[1]?.blocks[1]
    expect(pricing).toMatchObject({
      type: 'pricing',
      items: [
        {
          id: 'item-1',
          productId: 'prod1',
          unitPrice: 100,
          quantity: 10,
          discountPct: 10,
          recurrence: 'monthly',
        },
        { id: 'item-2', productId: null, recurrence: 'once' },
      ],
    })
    expect(pricing && 'items' in pricing && pricing.items[1]).not.toHaveProperty(
      'discountPct',
    )
    expect(docs.create.mock.calls[0]?.[0]).toMatchObject({
      totalValue: 1400,
      validUntil,
      companyId: 'co1',
      personId: 'pe1',
      opportunityId: 'op1',
    })
  })

  it('starts from a document template', async () => {
    docs.findById.mockResolvedValue(
      ok(
        createFakeDocument({
          id: 'tpl1',
          isTemplate: true,
          content: { from: 'template' },
          theme: { a: 1 },
          settings: { layout: 'paged' },
          totalValue: new Prisma.Decimal(250),
        }),
      ),
    )

    expectOk(
      await Service.createProposal('u1', 'ws', {
        title: 'X',
        templateId: 'tpl1',
        validUntil: null,
      }),
    )

    expect(outlineToDocument).not.toHaveBeenCalled()
    expect(docs.create.mock.calls[0]?.[0]).toMatchObject({
      source: 'TEMPLATE',
      templateId: 'tpl1',
      content: { from: 'template' },
      theme: { a: 1 },
      settings: { layout: 'paged' },
      totalValue: 250,
      validUntil: null,
    })

    docs.findById.mockResolvedValue(
      ok(createFakeDocument({ id: 'tpl1', isTemplate: true, totalValue: null })),
    )
    expectOk(
      await Service.createProposal('u1', 'ws', { title: 'X', templateId: 'tpl1' }),
    )
    expect(docs.create.mock.calls[1]?.[0].totalValue).toBeNull()
  })

  it('refuses a non-template, a missing template and a failed lookup', async () => {
    docs.findById.mockResolvedValueOnce(ok(createFakeDocument()))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', templateId: 't' }),
      'DOCUMENT_TEMPLATE_NOT_FOUND',
    )
    docs.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', templateId: 't' }),
      'DOCUMENT_TEMPLATE_NOT_FOUND',
    )
    docs.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', templateId: 't' }),
      'DATABASE_ERROR',
    )
  })

  it('checks the owner and every CRM link inside the workspace', async () => {
    members.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', ownerId: 'u2' }),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    const missing = err(notFound('Registro'))
    leads.findById.mockResolvedValueOnce(missing)
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', leadId: 'l' }),
      'RESOURCE_NOT_FOUND',
    )
    people.findById.mockResolvedValueOnce(missing)
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', personId: 'p' }),
      'RESOURCE_NOT_FOUND',
    )
    companies.findById.mockResolvedValueOnce(missing)
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X', companyId: 'c' }),
      'RESOURCE_NOT_FOUND',
    )
    deals.findById.mockResolvedValueOnce(missing)
    expectErr(
      await Service.createProposal('u1', 'ws', {
        title: 'X',
        opportunityId: 'o',
      }),
      'RESOURCE_NOT_FOUND',
    )
    expect(docs.create).not.toHaveBeenCalled()

    expectOk(
      await Service.createProposal('u1', 'ws', { title: 'X', ownerId: 'u2' }),
    )
    expect(docs.create.mock.calls[0]?.[0].ownerId).toBe('u2')
  })

  it('denies a VIEWER and a disabled CRM module', async () => {
    asRole('VIEWER')
    expectErr(await Service.createProposal('u1', 'ws', { title: 'X' }), 'FORBIDDEN')
    asRole('MEMBER')
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X' }),
      'MODULE_DISABLED',
    )
  })

  it('propagates settings, line item, conversion and write failures', async () => {
    settings.findByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X' }),
      'DATABASE_ERROR',
    )

    deals.findById.mockResolvedValue(ok(createFakeCrmOpportunity()))
    lineItems.listByOpportunity.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.createProposal('u1', 'ws', {
        title: 'X',
        opportunityId: 'op1',
      }),
      'DATABASE_ERROR',
    )

    vi.mocked(outlineToDocument).mockImplementationOnce(() => {
      throw new Error('catalog')
    })
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X' }),
      'DOCUMENT_CONTENT_INVALID',
    )
    vi.mocked(outlineToDocument).mockImplementationOnce(() => {
      throw 'raw'
    })
    expect(
      expectErr(await Service.createProposal('u1', 'ws', { title: 'X' }))
        .message,
    ).toBe('raw')

    docs.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.createProposal('u1', 'ws', { title: 'X' }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
  })
})

describe('createForOpportunity', () => {
  it('links the deal, its company and point of contact', async () => {
    deals.findById.mockResolvedValue(
      ok(
        createFakeCrmOpportunity({
          id: 'op1',
          name: 'Implantação',
          companyId: 'co1',
          pointOfContactId: 'pe1',
        }),
      ),
    )
    companies.findById.mockResolvedValue(ok(createFakeCrmCompany()))
    people.findById.mockResolvedValue(ok(createFakeCrmPerson()))
    lineItems.listByOpportunity.mockResolvedValue(ok([]))

    expectOk(await Service.createForOpportunity('u1', 'ws', 'op1'))
    expect(docs.create.mock.calls[0]?.[0]).toMatchObject({
      title: 'Proposta — Implantação',
      opportunityId: 'op1',
      companyId: 'co1',
      personId: 'pe1',
      totalValue: null,
    })

    expectOk(
      await Service.createForOpportunity('u1', 'ws', 'op1', {
        title: '  Renovação 2027 ',
      }),
    )
    expect(docs.create.mock.calls[1]?.[0].title).toBe('Renovação 2027')
  })

  it('checks the permission and the deal', async () => {
    asRole('VIEWER')
    expectErr(await Service.createForOpportunity('u1', 'ws', 'op1'), 'FORBIDDEN')
    asRole('MEMBER')
    deals.findById.mockResolvedValue(err(notFound('Oportunidade')))
    expectErr(
      await Service.createForOpportunity('u1', 'ws', 'op1'),
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('reads', () => {
  it('lists the proposals of the workspace with the filters', async () => {
    docs.list.mockResolvedValue(ok([createFakeDocument({ id: 'd1' })]))
    const list = expectOk(
      await Service.listProposals('u1', 'ws', {
        status: 'SENT',
        leadId: 'le1',
        opportunityId: 'op1',
        isTemplate: true,
        take: 500,
      }),
    )
    expect(list.map((d) => d.id)).toEqual(['d1'])
    expect(docs.list).toHaveBeenCalledWith('ws', {
      kind: 'PROPOSAL',
      status: 'SENT',
      isTemplate: true,
      leadId: 'le1',
      opportunityId: 'op1',
      take: 200,
    })

    expectOk(await Service.listProposals('u1', 'ws'))
    expect(docs.list).toHaveBeenLastCalledWith(
      'ws',
      expect.objectContaining({ take: 200 }),
    )
  })

  it('denies non-members and propagates list errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.listProposals('u1', 'ws'), 'FORBIDDEN')
    asRole('VIEWER')
    docs.list.mockResolvedValue(err(databaseError()))
    expectErr(await Service.listProposals('u1', 'ws'), 'DATABASE_ERROR')
  })

  it('reads the latest lead proposal and a document of the workspace', async () => {
    const doc = createFakeDocument({ id: 'd1' })
    docs.latestProposalByLead.mockResolvedValue(ok(doc))
    docs.findById.mockResolvedValue(ok(doc))
    expect(expectOk(await Service.latestProposalForLead('ws', 'le1'))).toBe(doc)
    expect(docs.latestProposalByLead).toHaveBeenCalledWith('le1', 'ws')
    expect(expectOk(await Service.findInWorkspace('ws', 'd1'))).toBe(doc)
    expect(docs.findById).toHaveBeenCalledWith('d1', 'ws')
  })
})
