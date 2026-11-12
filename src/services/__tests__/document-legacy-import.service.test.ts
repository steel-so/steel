import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmProposal,
  createFakeCrmProposalSection,
} from '@/src/__tests__/factories/crm-proposal.factory'
import {
  createFakeCrmProposalTemplate,
  createFakeCrmProposalTemplateSection,
} from '@/src/__tests__/factories/crm-proposal-template.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeCrmProposalSignature } from '@/src/__tests__/factories/nov-crm-deals.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type {
  LegacyProposalRow,
  LegacyTemplateRow,
} from '@/src/repositories/document-legacy.repository'

vi.mock('@/src/repositories/document-legacy.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/lib/canvas-document/outline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/canvas-document/outline')>()
  return {
    ...actual,
    outlineToDocument: vi.fn(() => ({
      content: { version: 1, rootId: 'root', nodes: {} },
      theme: { primaryColor: '#000000' },
    })),
  }
})

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { outlineToDocument } from '@/src/lib/canvas-document/outline'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { DocumentLegacyRepository } from '@/src/repositories/document-legacy.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  canonicalJson,
  legacyTotalValue,
  DocumentLegacyImportService as Service,
  versionSha256,
} from '../document-legacy-import.service'

const repo = vi.mocked(DocumentLegacyRepository)
const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)

const T0 = new Date('2026-09-01T12:00:00.000Z')
const T1 = new Date('2026-09-02T12:00:00.000Z')
const T2 = new Date('2026-09-03T12:00:00.000Z')
const T3 = new Date('2026-09-04T12:00:00.000Z')

const pricing = {
  type: 'PRODUCTS_PRICING',
  items: [{ name: 'Plano', quantity: 2, unitPrice: 500, total: 1000 }],
  discount: 0,
  total: 1000,
}

function templateRow(over: Partial<LegacyTemplateRow> = {}): LegacyTemplateRow {
  return {
    ...createFakeCrmProposalTemplate({
      id: 'tpl1',
      workspaceId: 'ws',
      name: 'Modelo padrão',
      description: 'Para clientes novos',
      logoUrl: 'https://cdn.example.com/logo.png',
      createdById: 'author',
      position: 3,
      createdAt: T0,
    }),
    sections: [
      createFakeCrmProposalTemplateSection({
        type: 'PRODUCTS_PRICING',
        order: 0,
        defaultContent: pricing as Prisma.JsonValue,
      }),
    ],
    ...over,
  }
}

function proposalRow(over: Partial<LegacyProposalRow> = {}): LegacyProposalRow {
  return {
    ...createFakeCrmProposal({
      id: 'p1',
      workspaceId: 'ws',
      name: 'Proposta ACME',
      status: 'ACCEPTED',
      shareToken: 'share-1',
      responsibleId: 'seller',
      createdById: 'author',
      companyId: 'co1',
      contactId: 'pe1',
      opportunityId: 'op1',
      leadId: 'le1',
      templateId: null,
      validUntil: T3,
      acceptedAt: T2,
      acceptedByName: 'Maria',
      createdAt: T0,
      updatedAt: T3,
    }),
    sections: [
      createFakeCrmProposalSection({
        type: 'PRODUCTS_PRICING',
        order: 0,
        content: pricing as Prisma.JsonValue,
      }),
    ],
    views: [
      {
        id: 'v1',
        proposalId: 'p1',
        viewId: 'view-1',
        ipHash: 'a'.repeat(64),
        durationMs: 4200,
        reachedEnd: true,
        scrolledPct: 100,
        referrer: null,
        createdAt: T1,
        updatedAt: T2,
      },
    ],
    signatures: [],
    template: null,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(outlineToDocument).mockReturnValue({
    content: { version: 1, rootId: 'root', nodes: {} } as never,
    theme: { primaryColor: '#000000' },
  })
  repo.documentIdByLegacyTemplate.mockResolvedValue(ok(null))
  repo.documentIdByLegacyProposal.mockResolvedValue(ok(null))
  access.isEnabled.mockResolvedValue(ok(true))
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
})

describe('helpers', () => {
  it('canonicalJson sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined, e: null }] })).toBe(
      '{"a":[{"d":2,"e":null}],"b":1}',
    )
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson({ y: 1, x: 2, z: 3 })).toBe('{"x":2,"y":1,"z":3}')
  })

  it('versionSha256 is stable whatever the key order', () => {
    const a = versionSha256({ x: 1, y: 2 }, {}, { layout: 'web' })
    const b = versionSha256({ y: 2, x: 1 }, {}, { layout: 'web' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('legacyTotalValue reads the enabled pricing section only', () => {
    expect(
      legacyTotalValue([
        { type: 'COVER', enabled: true, content: {} },
        { type: 'PRODUCTS_PRICING', enabled: false, content: pricing },
      ]),
    ).toBeNull()
    expect(
      legacyTotalValue([
        { type: 'PRODUCTS_PRICING', enabled: true, content: { bad: 1 } },
        { type: 'PRODUCTS_PRICING', enabled: true, content: pricing },
      ]),
    ).toBe(1000)
  })
})

describe('importTemplate', () => {
  it('creates a PROPOSAL template from the legacy template', async () => {
    repo.findTemplate.mockResolvedValue(ok(templateRow()))
    repo.createTemplateDocument.mockResolvedValue(ok({ id: 'doc-t' }))

    const out = expectOk(await Service.importTemplate('tpl1'))

    expect(out).toEqual({ documentId: 'doc-t', created: true })
    const data = repo.createTemplateDocument.mock.calls[0]?.[0]
    expect(data).toMatchObject({
      workspaceId: 'ws',
      isTemplate: true,
      status: 'DRAFT',
      title: 'Modelo padrão',
      description: 'Para clientes novos',
      legacyTemplateId: 'tpl1',
      ownerId: 'author',
      totalValue: 1000,
      position: 3,
      createdAt: T0,
      theme: { primaryColor: '#000000' },
    })
    expect(data?.publicToken).toMatch(/^[\w-]{43}$/)
    expect(vi.mocked(outlineToDocument).mock.calls[0]?.[0]).toMatchObject({
      title: 'Modelo padrão',
      theme: { logoUrl: 'https://cdn.example.com/logo.png' },
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'document', action: 'migrate' }),
    )
    expect(indexSearchDocument).toHaveBeenCalledWith(
      'crm-document',
      'ws',
      'doc-t',
    )
  })

  it('returns the existing document without converting again', async () => {
    repo.documentIdByLegacyTemplate.mockResolvedValue(ok('doc-t'))
    expect(expectOk(await Service.importTemplate('tpl1'))).toEqual({
      documentId: 'doc-t',
      created: false,
    })
    expect(repo.findTemplate).not.toHaveBeenCalled()
  })

  it('re-reads the id when another run migrated it first', async () => {
    repo.findTemplate.mockResolvedValue(ok(templateRow()))
    repo.createTemplateDocument.mockResolvedValue(ok(null))
    repo.documentIdByLegacyTemplate
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok('doc-other'))
    expect(expectOk(await Service.importTemplate('tpl1'))).toEqual({
      documentId: 'doc-other',
      created: false,
    })

    repo.documentIdByLegacyTemplate
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.importTemplate('tpl1'),
      'CRM_PROPOSAL_TEMPLATE_NOT_FOUND',
    )

    repo.documentIdByLegacyTemplate
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importTemplate('tpl1'), 'DATABASE_ERROR')
  })

  it('fails on a missing template, a conversion error or a database error', async () => {
    repo.documentIdByLegacyTemplate.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importTemplate('tpl1'), 'DATABASE_ERROR')

    repo.findTemplate.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importTemplate('tpl1'), 'DATABASE_ERROR')

    repo.findTemplate.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.importTemplate('tpl1'),
      'CRM_PROPOSAL_TEMPLATE_NOT_FOUND',
    )

    repo.findTemplate.mockResolvedValue(ok(templateRow()))
    vi.mocked(outlineToDocument).mockImplementationOnce(() => {
      throw new Error('catalog says no')
    })
    const conversion = expectErr(
      await Service.importTemplate('tpl1'),
      'DOCUMENT_CONTENT_INVALID',
    )
    expect(conversion.message).toBe('catalog says no')

    vi.mocked(outlineToDocument).mockImplementationOnce(() => {
      throw 'plain'
    })
    expect(expectErr(await Service.importTemplate('tpl1')).message).toBe(
      'plain',
    )

    repo.createTemplateDocument.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importTemplate('tpl1'), 'DATABASE_ERROR')
  })
})

describe('importProposal', () => {
  it('migrates an accepted proposal with version, response, sessions and events', async () => {
    repo.findProposal.mockResolvedValue(ok(proposalRow()))
    repo.createProposalDocument.mockResolvedValue(ok({ id: 'doc-p' }))

    const out = expectOk(await Service.importProposal('p1'))

    expect(out).toEqual({ documentId: 'doc-p', created: true })
    const write = repo.createProposalDocument.mock.calls[0]?.[0]
    expect(write?.document).toMatchObject({
      status: 'ACCEPTED',
      title: 'Proposta ACME',
      publicToken: 'share-1',
      legacyProposalId: 'p1',
      ownerId: 'seller',
      companyId: 'co1',
      personId: 'pe1',
      opportunityId: 'op1',
      leadId: 'le1',
      validUntil: T3,
      acceptedAt: T2,
      acceptedByName: 'Maria',
      totalValue: 1000,
      firstViewedAt: T1,
      lastViewedAt: T2,
      sentAt: T1,
      templateId: null,
    })
    expect(write?.version).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      createdAt: T1,
    })
    expect(write?.acceptance).toEqual({ name: 'Maria', createdAt: T2 })
    expect(write?.sessions).toEqual([
      {
        sessionKey: 'view-1',
        visitorId: `legacy-${'a'.repeat(32)}`,
        ipHash: 'a'.repeat(64),
        referrer: null,
        startedAt: T1,
        lastSeenAt: T2,
        activeMs: 4200,
        maxScrollPct: 100,
        reachedEnd: true,
      },
    ])
    expect(write?.events.map((e) => e.type)).toEqual([
      'CREATED',
      'SENT',
      'ACCEPTED',
    ])
    expect(write?.events[2]).toMatchObject({
      data: { legacy: true, name: 'Maria' },
      createdAt: T2,
    })
    expect(
      vi.mocked(outlineToDocument).mock.calls[0]?.[0].sections.at(-1),
    ).toMatchObject({ name: 'Aceite' })
  })

  it('logs one ACCEPTED event per legacy signature, keeping the signature data out', async () => {
    const signedAt = new Date('2026-09-03T15:00:00.000Z')
    repo.findProposal.mockResolvedValue(
      ok(
        proposalRow({
          signatures: [
            createFakeCrmProposalSignature({
              proposalId: 'p1',
              signerName: 'Maria Souza',
              signedAt,
            }),
          ],
        }),
      ),
    )
    repo.createProposalDocument.mockResolvedValue(ok({ id: 'doc-p' }))

    expectOk(await Service.importProposal('p1'))

    const events = repo.createProposalDocument.mock.calls[0]?.[0].events ?? []
    const accepted = events.filter((e) => e.type === 'ACCEPTED')
    expect(accepted).toEqual([
      {
        type: 'ACCEPTED',
        data: {
          legacySignature: true,
          signerName: 'Maria Souza',
          signedAt: signedAt.toISOString(),
        },
        createdAt: signedAt,
      },
    ])
  })

  it('keeps a draft without version and maps rejected and expired statuses', async () => {
    repo.createProposalDocument.mockResolvedValue(ok({ id: 'doc-p' }))

    repo.findProposal.mockResolvedValueOnce(
      ok(
        proposalRow({
          status: 'DRAFT',
          acceptedAt: null,
          acceptedByName: null,
          validUntil: null,
          views: [],
        }),
      ),
    )
    expectOk(await Service.importProposal('p1'))
    const draft = repo.createProposalDocument.mock.calls[0]?.[0]
    expect(draft?.document).toMatchObject({
      status: 'DRAFT',
      sentAt: null,
      firstViewedAt: null,
      lastViewedAt: null,
    })
    expect(draft?.version).toBeNull()
    expect(draft?.acceptance).toBeNull()
    expect(draft?.events.map((e) => e.type)).toEqual(['CREATED'])

    repo.findProposal.mockResolvedValueOnce(
      ok(
        proposalRow({
          status: 'REJECTED',
          acceptedAt: null,
          acceptedByName: null,
          views: [],
        }),
      ),
    )
    expectOk(await Service.importProposal('p1'))
    const rejected = repo.createProposalDocument.mock.calls[1]?.[0]
    expect(rejected?.document.status).toBe('DECLINED')
    expect(rejected?.document.sentAt).toEqual(T3)
    expect(rejected?.events.map((e) => e.type)).toEqual([
      'CREATED',
      'SENT',
      'DECLINED',
    ])

    repo.findProposal.mockResolvedValueOnce(
      ok(
        proposalRow({
          status: 'EXPIRED',
          acceptedAt: null,
          acceptedByName: null,
          expiredAt: T3,
        }),
      ),
    )
    expectOk(await Service.importProposal('p1'))
    const expired = repo.createProposalDocument.mock.calls[2]?.[0]
    expect(expired?.document.status).toBe('EXPIRED')
    expect(expired?.events.at(-1)).toMatchObject({ type: 'EXPIRED' })

    repo.findProposal.mockResolvedValueOnce(
      ok(proposalRow({ acceptedByName: null })),
    )
    expectOk(await Service.importProposal('p1'))
    expect(repo.createProposalDocument.mock.calls[3]?.[0].acceptance).toEqual({
      name: 'Cliente',
      createdAt: T2,
    })
  })

  it('migrates the template first and links it', async () => {
    repo.findProposal.mockResolvedValue(
      ok(
        proposalRow({
          templateId: 'tpl1',
          template: { logoUrl: 'https://cdn.example.com/l.png' },
        }),
      ),
    )
    repo.documentIdByLegacyTemplate.mockResolvedValue(ok('doc-t'))
    repo.createProposalDocument.mockResolvedValue(ok({ id: 'doc-p' }))

    expectOk(await Service.importProposal('p1'))
    expect(
      repo.createProposalDocument.mock.calls[0]?.[0].document.templateId,
    ).toBe('doc-t')

    repo.documentIdByLegacyTemplate.mockResolvedValue(ok(null))
    repo.findTemplate.mockResolvedValue(ok(null))
    expectOk(await Service.importProposal('p1'))
    expect(
      repo.createProposalDocument.mock.calls[1]?.[0].document.templateId,
    ).toBeNull()
  })

  it('returns the existing document and handles races and failures', async () => {
    repo.documentIdByLegacyProposal.mockResolvedValueOnce(ok('doc-p'))
    expect(expectOk(await Service.importProposal('p1'))).toEqual({
      documentId: 'doc-p',
      created: false,
    })

    repo.documentIdByLegacyProposal.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importProposal('p1'), 'DATABASE_ERROR')

    repo.findProposal.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importProposal('p1'), 'DATABASE_ERROR')

    repo.findProposal.mockResolvedValueOnce(ok(null))
    expectErr(await Service.importProposal('p1'), 'CRM_PROPOSAL_NOT_FOUND')

    repo.findProposal.mockResolvedValue(ok(proposalRow()))
    vi.mocked(outlineToDocument).mockImplementationOnce(() => {
      throw new Error('bad')
    })
    expectErr(await Service.importProposal('p1'), 'DOCUMENT_CONTENT_INVALID')

    repo.createProposalDocument.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.importProposal('p1'), 'DATABASE_ERROR')

    repo.createProposalDocument.mockResolvedValueOnce(ok(null))
    repo.documentIdByLegacyProposal
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok('doc-race'))
    expect(expectOk(await Service.importProposal('p1'))).toEqual({
      documentId: 'doc-race',
      created: false,
    })
  })
})

describe('importWorkspace', () => {
  it('migrates templates then proposals in batches and skips failures', async () => {
    repo.pendingTemplateIds
      .mockResolvedValueOnce(ok(['tpl1']))
      .mockResolvedValueOnce(ok([]))
    repo.pendingProposalIds
      .mockResolvedValueOnce(ok(['p1', 'p2']))
      .mockResolvedValueOnce(ok(['p2']))
    repo.findTemplate.mockResolvedValue(ok(templateRow()))
    repo.createTemplateDocument.mockResolvedValue(ok({ id: 'doc-t' }))
    repo.findProposal.mockImplementation(async (id) =>
      id === 'p1' ? ok(proposalRow()) : ok(null),
    )
    repo.createProposalDocument.mockResolvedValue(ok({ id: 'doc-p' }))

    const summary = expectOk(await Service.importWorkspace('ws', 2))

    expect(summary).toEqual({ templates: 1, proposals: 1, failed: 1 })
    expect(repo.pendingTemplateIds).toHaveBeenCalledWith('ws', 2)
    expect(repo.pendingProposalIds).toHaveBeenLastCalledWith('ws', 3)
    expect(logger.warn).toHaveBeenCalledWith(
      'documents.legacy_import.record_failed',
      expect.objectContaining({ legacyId: 'p2', kind: 'proposal' }),
    )
  })

  it('propagates a failure reading the pending records', async () => {
    repo.pendingTemplateIds.mockResolvedValue(err(databaseError()))
    expectErr(await Service.importWorkspace('ws'), 'DATABASE_ERROR')
  })

  it('lists the legacy workspaces through the repository', async () => {
    repo.legacyWorkspaceIds.mockResolvedValue(ok(['ws']))
    expect(expectOk(await Service.listWorkspaces())).toEqual(['ws'])
  })
})

describe('documentForProposal', () => {
  it('converts the proposal of the workspace and returns its document', async () => {
    repo.findProposalRef.mockResolvedValue(ok({ id: 'p1' }))
    repo.documentIdByLegacyProposal.mockResolvedValue(ok('doc-p'))
    expect(expectOk(await Service.documentForProposal('u', 'ws', 'p1'))).toBe(
      'doc-p',
    )
    expect(repo.findProposalRef).toHaveBeenCalledWith('p1', 'ws')
  })

  it('denies non-members and fails on missing proposals and errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await Service.documentForProposal('u', 'ws', 'p1'), 'FORBIDDEN')

    repo.findProposalRef.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.documentForProposal('u', 'ws', 'p1'),
      'DATABASE_ERROR',
    )

    repo.findProposalRef.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.documentForProposal('u', 'ws', 'p1'),
      'CRM_PROPOSAL_NOT_FOUND',
    )

    repo.findProposalRef.mockResolvedValueOnce(ok({ id: 'p1' }))
    repo.documentIdByLegacyProposal.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.documentForProposal('u', 'ws', 'p1'),
      'DATABASE_ERROR',
    )
  })
})

describe('ensurePublicToken', () => {
  it('is true for a document token and converts a legacy proposal token', async () => {
    repo.documentIdByPublicToken.mockResolvedValueOnce(ok('doc-p'))
    expect(expectOk(await Service.ensurePublicToken('tok'))).toBe(true)
    expect(repo.findProposalRefByShareToken).not.toHaveBeenCalled()

    repo.documentIdByPublicToken.mockResolvedValue(ok(null))
    repo.findProposalRefByShareToken.mockResolvedValueOnce(ok({ id: 'p1' }))
    repo.documentIdByLegacyProposal.mockResolvedValueOnce(ok('doc-p'))
    expect(expectOk(await Service.ensurePublicToken('tok'))).toBe(true)
    expect(repo.documentIdByLegacyProposal).toHaveBeenCalledWith('p1')
  })

  it('is false for an unknown token and propagates errors', async () => {
    repo.documentIdByPublicToken.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.ensurePublicToken('tok'), 'DATABASE_ERROR')

    repo.documentIdByPublicToken.mockResolvedValue(ok(null))
    repo.findProposalRefByShareToken.mockResolvedValueOnce(ok(null))
    expect(expectOk(await Service.ensurePublicToken('tok'))).toBe(false)

    repo.findProposalRefByShareToken.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.ensurePublicToken('tok'), 'DATABASE_ERROR')

    repo.findProposalRefByShareToken.mockResolvedValueOnce(ok({ id: 'p1' }))
    repo.documentIdByLegacyProposal.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.ensurePublicToken('tok'), 'DATABASE_ERROR')
  })
})
