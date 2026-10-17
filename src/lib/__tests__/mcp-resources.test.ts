import { describe, expect, it, vi } from 'vitest'
import { databaseError, sdKbArticleNotFound, wikiDisabled } from '@/src/errors'
import {
  KB_URI_PREFIX,
  listMcpResources,
  MCP_RESOURCE_TEMPLATES,
  RESOURCES_PAGE_SIZE,
  readMcpResource,
  WIKI_URI_PREFIX,
} from '@/src/lib/mcp/resources'
import { err, ok } from '@/src/lib/result'
import type { SdKbArticleDTO } from '@/types/sd-kb-article'
import type { WikiPageDTO } from '@/types/wiki-page'
import { mcpAccess, mcpGrant } from './mcp.fixtures'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/sd-kb-article.service', () => ({
  SdKbArticleService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/wiki-page.service', () => ({
  WikiPageService: { list: vi.fn(), getById: vi.fn() },
}))

import { SdKbArticleService } from '@/src/services/sd-kb-article.service'
import { WikiPageService } from '@/src/services/wiki-page.service'

const content = [{ type: 'p', children: [{ text: 'Reinicie o roteador.' }] }]

function article(overrides: Partial<SdKbArticleDTO> = {}): SdKbArticleDTO {
  return {
    id: 'a1',
    title: 'Sem internet',
    status: 'PUBLISHED',
    archivedAt: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
    content,
    ...overrides,
  } as SdKbArticleDTO
}

function page(overrides: Partial<WikiPageDTO> = {}): WikiPageDTO {
  return {
    id: 'p1',
    title: 'Onboarding',
    archivedAt: null,
    updatedAt: '2026-10-02T10:00:00.000Z',
    content,
    ...overrides,
  } as WikiPageDTO
}

const uris = (r: { resources: { uri: string }[] }) =>
  r.resources.map((x) => x.uri)

describe('listMcpResources()', () => {
  it('should list published KB articles and wiki pages', async () => {
    vi.mocked(SdKbArticleService.list).mockResolvedValue(
      ok([
        article(),
        article({ id: 'draft', status: 'DRAFT' }),
        article({ id: 'old', archivedAt: '2026-01-01T00:00:00.000Z' }),
      ]),
    )
    vi.mocked(WikiPageService.list).mockResolvedValue(
      ok([
        page(),
        page({ id: 'p2', title: '' }),
        page({ id: 'gone', archivedAt: '2026-01-01T00:00:00.000Z' }),
      ]),
    )

    const result = await listMcpResources(mcpGrant(), mcpAccess())

    expect(SdKbArticleService.list).toHaveBeenCalledWith('u1', 'ws1', {
      archived: false,
    })
    expect(uris(result)).toEqual([
      `${KB_URI_PREFIX}a1`,
      `${WIKI_URI_PREFIX}p1`,
      `${WIKI_URI_PREFIX}p2`,
    ])
    expect(result.resources[0]).toMatchObject({
      name: 'Sem internet',
      mimeType: 'text/markdown',
      annotations: { lastModified: '2026-10-01T10:00:00.000Z' },
    })
    expect(result.resources[2].name).toBe('Sem título')
    expect(result.nextCursor).toBeUndefined()
  })

  it('should skip the KB when ServiceDesk is outside the grant or disabled', async () => {
    vi.mocked(SdKbArticleService.list).mockClear()
    vi.mocked(WikiPageService.list).mockResolvedValue(ok([page()]))

    const notGranted = await listMcpResources(
      mcpGrant({ modules: ['CRM'] }),
      mcpAccess(),
    )
    const disabled = await listMcpResources(
      mcpGrant(),
      mcpAccess({ modules: ['CRM'] }),
    )

    expect(uris(notGranted)).toEqual([`${WIKI_URI_PREFIX}p1`])
    expect(uris(disabled)).toEqual([`${WIKI_URI_PREFIX}p1`])
    expect(SdKbArticleService.list).not.toHaveBeenCalled()
  })

  it('should treat access denials as an empty source', async () => {
    vi.mocked(SdKbArticleService.list).mockResolvedValue(
      err(sdKbArticleNotFound()),
    )
    vi.mocked(WikiPageService.list).mockResolvedValue(err(wikiDisabled()))

    expect(await listMcpResources(mcpGrant(), mcpAccess())).toEqual({
      resources: [],
    })
  })

  it('should fail with an internal error on a database error', async () => {
    vi.mocked(SdKbArticleService.list).mockResolvedValue(ok([]))
    vi.mocked(WikiPageService.list).mockResolvedValue(
      err(databaseError('boom')),
    )

    await expect(
      listMcpResources(mcpGrant(), mcpAccess()),
    ).rejects.toMatchObject({ code: -32603 })
  })

  it('should paginate with an opaque cursor', async () => {
    const many = Array.from({ length: RESOURCES_PAGE_SIZE + 5 }, (_, i) =>
      page({ id: `p${i}` }),
    )
    vi.mocked(SdKbArticleService.list).mockResolvedValue(ok([]))
    vi.mocked(WikiPageService.list).mockResolvedValue(ok(many))

    const first = await listMcpResources(mcpGrant(), mcpAccess())
    expect(first.resources).toHaveLength(RESOURCES_PAGE_SIZE)
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = await listMcpResources(
      mcpGrant(),
      mcpAccess(),
      first.nextCursor,
    )
    expect(second.resources).toHaveLength(5)
    expect(second.nextCursor).toBeUndefined()
  })

  it('should reject a malformed cursor', async () => {
    const bad = Buffer.from('-3').toString('base64url')
    await expect(
      listMcpResources(mcpGrant(), mcpAccess(), bad),
    ).rejects.toMatchObject({ code: -32602 })
  })
})

describe('readMcpResource()', () => {
  it('should read a published KB article as Markdown', async () => {
    vi.mocked(SdKbArticleService.getById).mockResolvedValue(ok(article()))
    const uri = `${KB_URI_PREFIX}a1`

    expect(await readMcpResource(mcpGrant(), mcpAccess(), uri)).toEqual({
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: '# Sem internet\n\nReinicie o roteador.\n',
        },
      ],
    })
    expect(SdKbArticleService.getById).toHaveBeenCalledWith('u1', 'ws1', 'a1')
  })

  it('should hide KB drafts, archived articles and denied reads', async () => {
    const uri = `${KB_URI_PREFIX}a1`
    for (const value of [
      ok(article({ status: 'DRAFT' })),
      ok(article({ archivedAt: '2026-01-01T00:00:00.000Z' })),
      err(sdKbArticleNotFound()),
    ]) {
      vi.mocked(SdKbArticleService.getById).mockResolvedValue(value as never)
      await expect(
        readMcpResource(mcpGrant(), mcpAccess(), uri),
      ).rejects.toMatchObject({ code: -32002 })
    }
  })

  it('should not read the KB outside the grant, or without an id', async () => {
    vi.mocked(SdKbArticleService.getById).mockClear()
    await expect(
      readMcpResource(
        mcpGrant({ modules: ['CRM'] }),
        mcpAccess(),
        `${KB_URI_PREFIX}a1`,
      ),
    ).rejects.toMatchObject({ code: -32002 })
    await expect(
      readMcpResource(mcpGrant(), mcpAccess(), KB_URI_PREFIX),
    ).rejects.toMatchObject({ code: -32002 })
    expect(SdKbArticleService.getById).not.toHaveBeenCalled()
  })

  it('should fail with an internal error when the KB read breaks', async () => {
    vi.mocked(SdKbArticleService.getById).mockResolvedValue(
      err(databaseError('boom')),
    )
    await expect(
      readMcpResource(mcpGrant(), mcpAccess(), `${KB_URI_PREFIX}a1`),
    ).rejects.toMatchObject({ code: -32603 })
  })

  it('should read a wiki page, with a fallback title for empty ones', async () => {
    vi.mocked(WikiPageService.getById).mockResolvedValue(
      ok(page({ title: '', content: [] as never })),
    )
    const uri = `${WIKI_URI_PREFIX}p1`

    const result = await readMcpResource(mcpGrant(), mcpAccess(), uri)

    expect(result.contents[0]).toEqual({
      uri,
      mimeType: 'text/markdown',
      text: '# Sem título\n',
    })
  })

  it('should hide archived and denied wiki pages', async () => {
    const uri = `${WIKI_URI_PREFIX}p1`
    for (const value of [
      ok(page({ archivedAt: '2026-01-01T00:00:00.000Z' })),
      err(wikiDisabled()),
    ]) {
      vi.mocked(WikiPageService.getById).mockResolvedValue(value as never)
      await expect(
        readMcpResource(mcpGrant(), mcpAccess(), uri),
      ).rejects.toMatchObject({ code: -32002 })
    }
    await expect(
      readMcpResource(mcpGrant(), mcpAccess(), WIKI_URI_PREFIX),
    ).rejects.toMatchObject({ code: -32002 })
  })

  it('should fail with an internal error when the wiki read breaks', async () => {
    vi.mocked(WikiPageService.getById).mockResolvedValue(
      err(databaseError('boom')),
    )
    await expect(
      readMcpResource(mcpGrant(), mcpAccess(), `${WIKI_URI_PREFIX}p1`),
    ).rejects.toMatchObject({ code: -32603 })
  })

  it('should describe one template per resource kind', () => {
    expect(MCP_RESOURCE_TEMPLATES.map((t) => t.uriTemplate)).toEqual([
      `${KB_URI_PREFIX}{articleId}`,
      `${WIKI_URI_PREFIX}{pageId}`,
    ])
  })
})
