import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/wiki-page.service')
vi.mock('@/src/services/document.service')
vi.mock('@/src/services/workspace.service')

import { DocumentService } from '@/src/services/document.service'
import { WikiPageService } from '@/src/services/wiki-page.service'
import { WorkspaceService } from '@/src/services/workspace.service'
import type { DocumentDTO, DocumentListItemDTO } from '@/types/document'
import type { WikiPageDTO } from '@/types/wiki-page'
import { STEEL_AI_TOOLS } from '../ai/tools'
import {
  DOCUMENT_AI_TOOLS,
  documentCreateTool,
  documentGetTool,
  documentsListTool,
} from '../ai/tools/documents'
import { validateToolRegistry } from '../ai/tools/registry'
import {
  textToPlateBlocks,
  WIKI_AI_TOOLS,
  wikiPageCreateTool,
  wikiPageGetTool,
  wikiPagesListTool,
} from '../ai/tools/wiki'
import { previewOf } from './zap-ai-fixtures'

const wiki = vi.mocked(WikiPageService)
const docs = vi.mocked(DocumentService)
const workspaces = vi.mocked(WorkspaceService)

const ctx = { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' as const }

function wikiPage(overrides: Partial<WikiPageDTO> = {}): WikiPageDTO {
  return {
    id: 'p1',
    workspaceId: 'ws1',
    parentId: null,
    title: 'Política de troca',
    icon: null,
    coverImage: null,
    content: [{ type: 'p', children: [{ text: 'Trocas em até 7 dias.' }] }],
    position: 0,
    labelIds: [],
    createdById: 'u1',
    updatedById: 'u1',
    archivedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
    publishedAt: null,
    publicToken: null,
    ...overrides,
  } as WikiPageDTO
}

function listItem(
  overrides: Partial<DocumentListItemDTO> = {},
): DocumentListItemDTO {
  return {
    id: 'd1',
    workspaceId: 'ws1',
    title: 'Contrato Acme',
    kind: 'CONTRACT',
    status: 'DRAFT',
    isTemplate: false,
    totalValue: 1000,
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    viewCount: 0,
    company: { id: 'c1', name: 'Acme' },
    person: null,
    ...overrides,
  } as DocumentListItemDTO
}

beforeEach(() => {
  vi.resetAllMocks()
  workspaces.getById.mockResolvedValue(ok({ id: 'ws1', slug: 'acme' } as never))
})

describe('registries', () => {
  it('should be valid and registered once', () => {
    expect(validateToolRegistry(WIKI_AI_TOOLS)).toEqual([])
    expect(validateToolRegistry(DOCUMENT_AI_TOOLS)).toEqual([])
    const names = STEEL_AI_TOOLS.map((t) => t.name)
    for (const tool of [...WIKI_AI_TOOLS, ...DOCUMENT_AI_TOOLS]) {
      expect(names.filter((n) => n === tool.name)).toHaveLength(1)
    }
  })

  it('should keep Wiki platform-level and Documents in the CRM module', () => {
    expect(WIKI_AI_TOOLS.every((t) => t.module === null)).toBe(true)
    expect(DOCUMENT_AI_TOOLS.every((t) => t.module === 'CRM')).toBe(true)
  })

  it('should not expose any customer-facing send for documents', () => {
    expect(DOCUMENT_AI_TOOLS.some((t) => t.customerFacing)).toBe(false)
  })
})

const runWikiList = async (raw: Record<string, unknown> = {}) =>
  wikiPagesListTool.execute(ctx, expectOk(wikiPagesListTool.parse(raw)))
const runDocList = async (raw: Record<string, unknown> = {}) =>
  documentsListTool.execute(ctx, expectOk(documentsListTool.parse(raw)))

describe('wiki_pages_list', () => {
  it('should list live pages, filter by title ignoring accents and paginate', async () => {
    wiki.list.mockResolvedValue(
      ok([
        wikiPage({ id: 'a', title: 'Política de troca' }),
        wikiPage({ id: 'b', title: 'Onboarding' }),
        wikiPage({ id: 'c', title: 'Politica antiga', archivedAt: 'x' }),
      ]),
    )

    const all = expectOk(
      await runWikiList(),
    )
    expect((all.data as { total: number }).total).toBe(2)

    const filtered = expectOk(
      await runWikiList({ query: 'POLITICA' }),
    )
    expect(filtered.data).toMatchObject({
      total: 1,
      items: [{ id: 'a', title: 'Política de troca', published: false }],
    })
    expect(filtered.summary).toBe('1 página(s) da Wiki')
  })

  it('should surface a service error and label untitled pages', async () => {
    wiki.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await runWikiList(),
      'FORBIDDEN',
    )
    wiki.list.mockResolvedValueOnce(ok([wikiPage({ title: '' })]))
    const out = expectOk(
      await runWikiList(),
    )
    expect(out.data).toMatchObject({ items: [{ title: 'Sem título' }] })
  })
})

describe('wiki_page_get', () => {
  it('should return the plain text and the link', async () => {
    wiki.getById.mockResolvedValue(ok(wikiPage({ publishedAt: 'x' })))
    const out = expectOk(
      await wikiPageGetTool.execute(
        ctx,
        expectOk(wikiPageGetTool.parse({ pageId: 'p1' })),
      ),
    )
    expect(wiki.getById).toHaveBeenCalledWith('u1', 'ws1', 'p1')
    expect(out.data).toMatchObject({
      id: 'p1',
      published: true,
      text: 'Trocas em até 7 dias.',
      href: '/acme/wiki/p1',
    })
  })

  it('should omit the link when the workspace cannot be read and keep errors', async () => {
    wiki.getById.mockResolvedValueOnce(ok(wikiPage({ title: '' })))
    workspaces.getById.mockResolvedValueOnce(err(databaseError('x')))
    const out = expectOk(
      await wikiPageGetTool.execute(ctx, { pageId: 'p1' }),
    )
    expect((out.data as { href?: string }).href).toBeUndefined()
    expect(out.summary).toBe('Página “Sem título”')

    wiki.getById.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await wikiPageGetTool.execute(ctx, { pageId: 'p1' }),
      'FORBIDDEN',
    )
    expectErr(wikiPageGetTool.parse({}), 'VALIDATION_ERROR')
  })
})

describe('wiki_page_create', () => {
  it('should be a non-destructive CREATE with a preview', async () => {
    expect(wikiPageCreateTool.kind).toBe('CREATE')
    expect(wikiPageCreateTool.annotations).toEqual({ destructiveHint: false })
    const args = expectOk(
      wikiPageCreateTool.parse({ title: 'Nova', text: 'a\n\nb' }),
    )
    const preview = expectOk(
      await previewOf(wikiPageCreateTool)(ctx, args),
    )
    expect(preview.title).toBe('Criar a página “Nova” na Wiki')
    expect(preview.fields).toEqual([
      { label: 'Título', after: 'Nova' },
      { label: 'Texto inicial', after: 'a\n\nb' },
    ])
    const bare = expectOk(
      await previewOf(wikiPageCreateTool)(ctx, { title: 'Só título' }),
    )
    expect(bare.fields).toEqual([{ label: 'Título', after: 'Só título' }])
    expect(wiki.create).not.toHaveBeenCalled()
  })

  it('should create and then fill the content', async () => {
    wiki.create.mockResolvedValue(ok(wikiPage({ id: 'n1', title: 'Nova' })))
    wiki.update.mockResolvedValue(ok(wikiPage({ id: 'n1', title: 'Nova' })))

    const out = expectOk(
      await wikiPageCreateTool.execute(ctx, {
        title: 'Nova',
        parentId: 'root',
        text: 'linha 1\n\nlinha 2',
      }),
    )

    expect(wiki.create).toHaveBeenCalledWith('u1', 'ws1', {
      title: 'Nova',
      parentId: 'root',
    })
    expect(wiki.update).toHaveBeenCalledWith('u1', 'ws1', 'n1', {
      content: [
        { type: 'p', children: [{ text: 'linha 1' }] },
        { type: 'p', children: [{ text: 'linha 2' }] },
      ],
    })
    expect(out.target).toEqual({
      type: 'wiki_page',
      id: 'n1',
      label: 'Nova',
      href: '/acme/wiki/n1',
    })
  })

  it('should skip the content update without text and surface errors', async () => {
    wiki.create.mockResolvedValue(ok(wikiPage({ id: 'n1' })))
    expectOk(await wikiPageCreateTool.execute(ctx, { title: 'Nova' }))
    expect(wiki.update).not.toHaveBeenCalled()

    wiki.create.mockResolvedValueOnce(err(forbidden()))
    expectErr(await wikiPageCreateTool.execute(ctx, { title: 'x' }), 'FORBIDDEN')

    wiki.create.mockResolvedValueOnce(ok(wikiPage({ id: 'n2' })))
    wiki.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await wikiPageCreateTool.execute(ctx, { title: 'x', text: 'y' }),
      'DATABASE_ERROR',
    )
  })
})

describe('textToPlateBlocks', () => {
  it('should make one paragraph per non-empty line', () => {
    expect(textToPlateBlocks(' a \r\n\r\n b ')).toEqual([
      { type: 'p', children: [{ text: 'a' }] },
      { type: 'p', children: [{ text: 'b' }] },
    ])
    expect(textToPlateBlocks('  ')).toEqual([])
  })
})

describe('documents_list', () => {
  it('should map filters to the service query and paginate by offset', async () => {
    docs.list.mockResolvedValue(
      ok({ items: [listItem()], total: 41, page: 2, pageSize: 20 }),
    )
    const args = expectOk(
      documentsListTool.parse({
        query: 'acme',
        kind: 'CONTRACT',
        status: 'DRAFT',
        templates: true,
        companyId: 'c1',
        limit: 20,
        offset: 20,
      }),
    )

    const out = expectOk(await documentsListTool.execute(ctx, args))

    expect(docs.list).toHaveBeenCalledWith('u1', 'ws1', {
      isTemplate: true,
      kind: 'CONTRACT',
      status: 'DRAFT',
      q: 'acme',
      companyId: 'c1',
      personId: undefined,
      opportunityId: undefined,
      leadId: undefined,
      page: 2,
      pageSize: 20,
    })
    expect(out.data).toMatchObject({
      total: 41,
      offset: 20,
      limit: 20,
      hasMore: true,
      items: [
        {
          id: 'd1',
          kindLabel: 'Contrato',
          statusLabel: 'Rascunho',
          company: 'Acme',
          person: null,
          href: '/acme/crm/documents/d1',
        },
      ],
    })
  })

  it('should list real documents by default and surface errors', async () => {
    docs.list.mockResolvedValueOnce(
      ok({ items: [], total: 0, page: 1, pageSize: 20 }),
    )
    const out = expectOk(
      await runDocList(),
    )
    expect(docs.list).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({ isTemplate: false, page: 1 }),
    )
    expect(out.data).toMatchObject({ hasMore: false })

    docs.list.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await runDocList(),
      'FORBIDDEN',
    )
  })
})

describe('document_get', () => {
  it('should hide recipient contacts and the canvas content', async () => {
    docs.get.mockResolvedValue(
      ok({
        ...listItem(),
        description: 'Contrato anual',
        hasUnsentChanges: true,
        acceptedByName: null,
        declinedAt: null,
        declineReason: null,
        expiredAt: null,
        paidAt: null,
        content: { secret: true },
        recipients: [
          {
            id: 'r1',
            name: 'Maria',
            email: 'maria@x.com',
            phone: null,
            role: 'APPROVER',
          },
        ],
      } as unknown as DocumentDTO),
    )

    const out = expectOk(
      await documentGetTool.execute(ctx, { documentId: 'd1' }),
    )

    expect(docs.get).toHaveBeenCalledWith('u1', 'ws1', 'd1')
    expect(out.data).toMatchObject({
      description: 'Contrato anual',
      hasUnsentChanges: true,
      recipients: [{ name: 'Maria', role: 'APPROVER' }],
    })
    expect(JSON.stringify(out.data)).not.toContain('maria@x.com')
    expect(JSON.stringify(out.data)).not.toContain('secret')
  })

  it('should surface errors and validate the id', async () => {
    docs.get.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await documentGetTool.execute(ctx, { documentId: 'd1' }),
      'FORBIDDEN',
    )
    expectErr(documentGetTool.parse({}), 'VALIDATION_ERROR')
  })
})

describe('document_create', () => {
  it('should preview without creating and without sending anything', async () => {
    expect(documentCreateTool.kind).toBe('CREATE')
    const args = expectOk(
      documentCreateTool.parse({ title: 'Termo', kind: 'TERMS' }),
    )
    const preview = expectOk(await previewOf(documentCreateTool)(ctx, args))
    expect(preview.title).toBe('Criar o documento “Termo”')
    expect(preview.summary).toMatch(/rascunho/)
    expect(preview.fields).toEqual([
      { label: 'Título', after: 'Termo' },
      { label: 'Tipo', after: 'Termo' },
    ])
    expect(docs.create).not.toHaveBeenCalled()
  })

  it('should create a draft document with the links', async () => {
    docs.create.mockResolvedValue(
      ok({ id: 'd9', title: 'Termo' } as unknown as DocumentDTO),
    )
    const args = expectOk(
      documentCreateTool.parse({
        title: 'Termo',
        companyId: 'c1',
        templateId: 't1',
      }),
    )

    const out = expectOk(await documentCreateTool.execute(ctx, args))

    expect(docs.create).toHaveBeenCalledWith('u1', 'ws1', {
      title: 'Termo',
      kind: 'OTHER',
      description: undefined,
      isTemplate: false,
      templateId: 't1',
      companyId: 'c1',
      personId: undefined,
      opportunityId: undefined,
      leadId: undefined,
    })
    expect(out.target).toEqual({
      type: 'crm_document',
      id: 'd9',
      label: 'Termo',
      href: '/acme/crm/documents/d9',
    })
  })

  it('should surface creation errors', async () => {
    docs.create.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await documentCreateTool.execute(
        ctx,
        expectOk(documentCreateTool.parse({ title: 'x' })),
      ),
      'FORBIDDEN',
    )
  })
})
