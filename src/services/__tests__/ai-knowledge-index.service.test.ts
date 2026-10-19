import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { KNOWLEDGE_SOURCE_TYPES } from '@/src/lib/ai/knowledge/sources'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-knowledge-chunk.repository')
vi.mock('@/src/repositories/ai-knowledge-source.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/services/ai-knowledge-embedding.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import {
  AiKnowledgeSourceRepository,
  type KnowledgeCrmNoteRow,
  type KnowledgeWikiPageRow,
} from '@/src/repositories/ai-knowledge-source.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { AiKnowledgeEmbeddingService } from '@/src/services/ai-knowledge-embedding.service'
import {
  AiKnowledgeIndexService,
  KNOWLEDGE_REINDEX_BATCH,
} from '../ai-knowledge-index.service'

const chunks = vi.mocked(AiKnowledgeChunkRepository)
const sources = vi.mocked(AiKnowledgeSourceRepository)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const embedding = vi.mocked(AiKnowledgeEmbeddingService)

const WS = 'ws1'
const T = new Date('2026-10-01T00:00:00Z')

function page(id: string, text = 'Política de férias'): KnowledgeWikiPageRow {
  return {
    id,
    title: `Página ${id}`,
    content: [{ type: 'p', children: [{ text }] }],
    updatedAt: T,
  }
}

function aiOff() {
  settings.findByWorkspace.mockResolvedValue(
    ok(createFakeWorkspaceAiSettings({ workspaceId: WS, aiEnabled: false })),
  )
}

beforeEach(() => {
  settings.findByWorkspace.mockResolvedValue(ok(null))
  chunks.replaceSources.mockResolvedValue(ok(1))
  chunks.removeSources.mockResolvedValue(ok(0))
  chunks.removeStale.mockResolvedValue(ok(0))
  chunks.removeWorkspace.mockResolvedValue(ok(4))
  chunks.removeAiDisabled.mockResolvedValue(ok(0))
  chunks.now.mockResolvedValue(ok(T))
  chunks.enableVector.mockResolvedValue(ok(true))
  embedding.embedPending.mockResolvedValue(ok({ embedded: 2, inputTokens: 10 }))
  for (const load of [
    sources.kbArticles,
    sources.wikiPages,
    sources.resolvedTickets,
    sources.zapDocuments,
    sources.crmNotes,
    sources.crmProposals,
  ]) {
    load.mockResolvedValue(ok([]))
  }
  sources.ticketPrefixes.mockResolvedValue(ok(null))
  sources.aiEnabledWorkspaceIds.mockResolvedValue(ok([]))
})

describe('AiKnowledgeIndexService.refresh', () => {
  it('should chunk what the loader returns and drop what it no longer does', async () => {
    sources.wikiPages.mockResolvedValue(ok([page('p1')]))
    const stats = expectOk(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, [
        'p1',
        'gone',
        'p1',
        '',
      ]),
    )
    expect(stats).toEqual({ indexed: 1, removed: 1, embedded: 2 })
    expect(sources.wikiPages).toHaveBeenCalledWith(WS, {
      ids: ['p1', 'gone'],
      take: 2,
    })
    const [, type, written] = chunks.replaceSources.mock.calls[0]
    expect(type).toBe('wiki-page')
    expect(written[0].sourceId).toBe('p1')
    expect(written[0].chunks[0]).toMatchObject({
      title: 'Página p1',
      content: 'Política de férias',
      path: '/wiki/p1',
    })
    expect(chunks.removeSources).toHaveBeenCalledWith(WS, 'wiki-page', ['gone'])
    expect(embedding.embedPending).toHaveBeenCalledWith(WS)
  })

  it('should do nothing without ids', async () => {
    expect(
      expectOk(await AiKnowledgeIndexService.refresh('crm-note', WS, [])),
    ).toEqual({ indexed: 0, removed: 0, embedded: 0 })
    expect(settings.findByWorkspace).not.toHaveBeenCalled()
  })

  it('should purge instead of indexing a workspace with Steel AI off', async () => {
    aiOff()
    const stats = expectOk(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
    )
    expect(stats).toEqual({ indexed: 0, removed: 4, embedded: 0, purged: true })
    expect(sources.wikiPages).not.toHaveBeenCalled()
    expect(embedding.embedPending).not.toHaveBeenCalled()
  })

  it('should load every source type with its own loader', async () => {
    sources.resolvedTickets.mockResolvedValue(
      ok([
        {
          id: 't1',
          number: 7,
          type: 'INCIDENT',
          title: 'VPN',
          description: null,
          solution: 'Reinstalar o cliente',
          requesterId: 'u1',
          updatedAt: T,
          contact: null,
          participants: [],
        },
      ]),
    )
    const note: KnowledgeCrmNoteRow = {
      id: 'n1',
      title: 'Nota',
      body: 'texto',
      companyId: null,
      personId: null,
      opportunityId: null,
      leadId: null,
      updatedAt: T,
      company: null,
      person: null,
      opportunity: null,
      lead: null,
    }
    sources.crmNotes.mockResolvedValue(ok([note]))
    for (const type of KNOWLEDGE_SOURCE_TYPES) {
      expectOk(await AiKnowledgeIndexService.refresh(type, WS, ['x']))
    }
    expect(sources.kbArticles).toHaveBeenCalled()
    expect(sources.resolvedTickets).toHaveBeenCalled()
    expect(sources.ticketPrefixes).toHaveBeenCalledWith(WS)
    expect(sources.zapDocuments).toHaveBeenCalled()
    expect(sources.crmProposals).toHaveBeenCalled()
    const ticketWrite = chunks.replaceSources.mock.calls.find(
      ([, type]) => type === 'sd-ticket',
    )
    expect(ticketWrite?.[2][0].chunks[0]).toMatchObject({
      audience: 'PARTIES',
      userIds: ['u1'],
    })
  })

  it('should keep the text half when embedding fails', async () => {
    sources.wikiPages.mockResolvedValue(ok([page('p1')]))
    embedding.embedPending.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1'])),
    ).toEqual({ indexed: 1, removed: 0, embedded: 0 })
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.embed_failed',
      expect.objectContaining({ code: 'DATABASE_ERROR' }),
    )
  })

  it('should propagate database errors', async () => {
    settings.findByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
      'DATABASE_ERROR',
    )
    sources.wikiPages.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
      'DATABASE_ERROR',
    )
    sources.ticketPrefixes.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('sd-ticket', WS, ['t']),
      'DATABASE_ERROR',
    )
    sources.resolvedTickets.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('sd-ticket', WS, ['t']),
      'DATABASE_ERROR',
    )
    chunks.replaceSources.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
      'DATABASE_ERROR',
    )
    chunks.removeSources.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
      'DATABASE_ERROR',
    )
    aiOff()
    chunks.removeWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.refresh('wiki-page', WS, ['p1']),
      'DATABASE_ERROR',
    )
  })
})

describe('AiKnowledgeIndexService.remove / purgeWorkspace', () => {
  it('should delegate to the repository', async () => {
    chunks.removeSources.mockResolvedValue(ok(3))
    expect(
      expectOk(await AiKnowledgeIndexService.remove('crm-note', WS, ['n1'])),
    ).toBe(3)
    expect(
      expectOk(await AiKnowledgeIndexService.purgeWorkspace(WS)),
    ).toMatchObject({ removed: 4, purged: true })
    expect(logger.info).toHaveBeenCalledWith(
      'ai.knowledge.workspace_purged',
      expect.objectContaining({ workspaceId: WS, chunks: 4 }),
    )
  })
})

describe('AiKnowledgeIndexService.reindexWorkspace', () => {
  it('should page through every source and drop stale chunks', async () => {
    const full = Array.from({ length: KNOWLEDGE_REINDEX_BATCH }, (_, i) =>
      page(`p${String(i).padStart(4, '0')}`),
    )
    sources.wikiPages
      .mockResolvedValueOnce(ok(full))
      .mockResolvedValueOnce(ok([page('z')]))
    chunks.removeStale.mockResolvedValue(ok(1))
    const stats = expectOk(await AiKnowledgeIndexService.reindexWorkspace(WS))
    expect(stats).toEqual({
      indexed: KNOWLEDGE_REINDEX_BATCH + 1,
      removed: KNOWLEDGE_SOURCE_TYPES.length,
      embedded: 2,
    })
    expect(sources.wikiPages).toHaveBeenLastCalledWith(WS, {
      afterId: full[full.length - 1].id,
      take: KNOWLEDGE_REINDEX_BATCH,
    })
    expect(chunks.removeStale).toHaveBeenCalledWith(WS, 'wiki-page', T)
  })

  it('should rebuild only the given source types', async () => {
    expectOk(await AiKnowledgeIndexService.reindexWorkspace(WS, ['crm-note']))
    expect(chunks.removeStale).toHaveBeenCalledTimes(1)
    expect(sources.wikiPages).not.toHaveBeenCalled()
  })

  it('should purge a workspace with Steel AI off', async () => {
    aiOff()
    expect(
      expectOk(await AiKnowledgeIndexService.reindexWorkspace(WS)).purged,
    ).toBe(true)
  })

  it('should propagate database errors', async () => {
    settings.findByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.reindexWorkspace(WS),
      'DATABASE_ERROR',
    )
    chunks.now.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.reindexWorkspace(WS),
      'DATABASE_ERROR',
    )
    sources.kbArticles.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.reindexWorkspace(WS),
      'DATABASE_ERROR',
    )
    chunks.replaceSources.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.reindexWorkspace(WS),
      'DATABASE_ERROR',
    )
    chunks.removeStale.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeIndexService.reindexWorkspace(WS),
      'DATABASE_ERROR',
    )
  })
})

describe('AiKnowledgeIndexService.reindexAll', () => {
  it('should enable pgvector, purge AI-off workspaces and reindex the rest', async () => {
    chunks.removeAiDisabled.mockResolvedValue(ok(5))
    const ids = Array.from({ length: 100 }, (_, i) => `w${i}`)
    sources.aiEnabledWorkspaceIds
      .mockResolvedValueOnce(ok(ids))
      .mockResolvedValueOnce(ok(['last']))
    sources.wikiPages.mockResolvedValue(ok([page('p')]))
    // One workspace fails: the run goes on.
    chunks.now.mockImplementation(async () => ok(T))
    chunks.now.mockResolvedValueOnce(err(databaseError()))

    const stats = expectOk(await AiKnowledgeIndexService.reindexAll())
    expect(stats).toMatchObject({
      workspaces: 101,
      failed: 1,
      indexed: 100,
      removed: 5,
      embedded: 200,
      vectorIndexReady: true,
    })
    expect(embedding.clearCache).toHaveBeenCalled()
    expect(sources.aiEnabledWorkspaceIds).toHaveBeenLastCalledWith('w99', 100)
    expect(logger.error).toHaveBeenCalledWith(
      'ai.knowledge.reindex_workspace_failed',
      expect.objectContaining({ workspaceId: 'w0' }),
    )
  })

  it('should report the vector index as off when pgvector is missing', async () => {
    chunks.enableVector.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await AiKnowledgeIndexService.reindexAll()).vectorIndexReady,
    ).toBe(false)
  })

  it('should fail when it cannot purge or list the workspaces', async () => {
    chunks.removeAiDisabled.mockResolvedValueOnce(err(databaseError()))
    expectErr(await AiKnowledgeIndexService.reindexAll(), 'DATABASE_ERROR')
    sources.aiEnabledWorkspaceIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await AiKnowledgeIndexService.reindexAll(), 'DATABASE_ERROR')
  })
})
