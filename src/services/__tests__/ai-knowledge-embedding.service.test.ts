import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEmbedding } from '@/src/__tests__/factories/ai-knowledge.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { aiKnowledgeEmbeddingFailed } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/lib/ai/knowledge/embeddings', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/lib/ai/knowledge/embeddings')
  >()),
  embedTexts: vi.fn(),
  isEmbeddingProviderConfigured: vi.fn(() => true),
}))
vi.mock('@/src/repositories/ai-knowledge-chunk.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/services/platform-ai-settings.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  embedTexts,
  isEmbeddingProviderConfigured,
} from '@/src/lib/ai/knowledge/embeddings'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import {
  AiUsageRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { PlatformAiSettingsService } from '@/src/services/platform-ai-settings.service'
import {
  AiKnowledgeEmbeddingService,
  EMBED_PAGE_SIZE,
  VECTOR_CHECK_TTL_MS,
} from '../ai-knowledge-embedding.service'

const embed = vi.mocked(embedTexts)
const chunks = vi.mocked(AiKnowledgeChunkRepository)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const usage = vi.mocked(AiUsageRepository)
const platform = vi.mocked(PlatformAiSettingsService)

const WS = 'ws1'

function totals(costUsd: number) {
  return { inputTokens: 0, outputTokens: 0, costUsd }
}

function toEmbed(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${offset + i}`,
    workspaceId: WS,
    title: 'T',
    content: `chunk ${offset + i}`,
    contentHash: `h${offset + i}`,
  }))
}

function vectors(n: number, inputTokens = 10) {
  return ok({
    vectors: Array.from({ length: n }, (_, i) => fakeEmbedding(i)),
    inputTokens,
  })
}

beforeEach(() => {
  AiKnowledgeEmbeddingService.clearCache()
  vi.mocked(isEmbeddingProviderConfigured).mockReturnValue(true)
  platform.getEmbeddingsEnabled.mockResolvedValue(true)
  platform.getCostMargin.mockResolvedValue(2)
  chunks.vectorEnabled.mockResolvedValue(ok(true))
  chunks.listToEmbed.mockResolvedValue(ok([]))
  chunks.saveEmbeddings.mockImplementation(async (_m, rows) => ok(rows.length))
  settings.findByWorkspace.mockResolvedValue(ok(null))
  usage.sumSince.mockResolvedValue(ok(totals(0)))
  usage.record.mockResolvedValue(ok(undefined))
  embed.mockImplementation(async (texts) => vectors(texts.length))
})

describe('AiKnowledgeEmbeddingService.unavailableReason', () => {
  it('should explain why embeddings cannot run', async () => {
    expect(await AiKnowledgeEmbeddingService.unavailableReason(0)).toBeNull()

    platform.getEmbeddingsEnabled.mockResolvedValueOnce(false)
    expect(await AiKnowledgeEmbeddingService.unavailableReason(0)).toBe(
      'disabled',
    )
    vi.mocked(isEmbeddingProviderConfigured).mockReturnValueOnce(false)
    expect(await AiKnowledgeEmbeddingService.unavailableReason(0)).toBe(
      'no_provider',
    )
  })

  it('should cache the pgvector check for a while', async () => {
    chunks.vectorEnabled.mockResolvedValue(ok(false))
    expect(await AiKnowledgeEmbeddingService.unavailableReason(0)).toBe(
      'no_vector_index',
    )
    chunks.vectorEnabled.mockResolvedValue(ok(true))
    expect(await AiKnowledgeEmbeddingService.unavailableReason(1_000)).toBe(
      'no_vector_index',
    )
    expect(
      await AiKnowledgeEmbeddingService.unavailableReason(
        VECTOR_CHECK_TTL_MS + 1,
      ),
    ).toBeNull()
    expect(chunks.vectorEnabled).toHaveBeenCalledTimes(2)

    AiKnowledgeEmbeddingService.clearCache()
    chunks.vectorEnabled.mockResolvedValue(err(databaseError()))
    expect(await AiKnowledgeEmbeddingService.unavailableReason(0)).toBe(
      'no_vector_index',
    )
  })
})

describe('AiKnowledgeEmbeddingService.embedPending', () => {
  it('should embed page by page and charge the workspace once', async () => {
    chunks.listToEmbed
      .mockResolvedValueOnce(ok(toEmbed(EMBED_PAGE_SIZE)))
      .mockResolvedValueOnce(ok(toEmbed(3, EMBED_PAGE_SIZE)))
    const stats = expectOk(await AiKnowledgeEmbeddingService.embedPending(WS))
    expect(stats).toEqual({ embedded: EMBED_PAGE_SIZE + 3, inputTokens: 20 })
    expect(embed).toHaveBeenCalledTimes(2)
    expect(embed.mock.calls[0][0][0]).toBe('T\n\nchunk 0')
    const saved = chunks.saveEmbeddings.mock.calls[0]
    expect(saved[0]).toBe('text-embedding-3-small')
    expect(saved[1][0]).toMatchObject({
      chunkId: 'c0',
      workspaceId: WS,
      contentHash: 'h0',
    })
    expect(saved[1][0].vector.startsWith('[')).toBe(true)
    expect(usage.record).toHaveBeenCalledTimes(1)
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: null,
        feature: 'KNOWLEDGE_SEARCH',
        provider: 'openai',
        model: 'text-embedding-3-small',
        inputTokens: 20,
        outputTokens: 0,
        // 20 tokens × US$ 0.02 / 1M × margin 2.
        costUsd: 0.000001,
      }),
    )
  })

  it('should stop at the cap and record nothing when there is nothing to do', async () => {
    chunks.listToEmbed.mockResolvedValue(ok(toEmbed(2)))
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS, 2)),
    ).toEqual({ embedded: 2, inputTokens: 10 })
    expect(chunks.listToEmbed).toHaveBeenCalledWith(
      WS,
      'text-embedding-3-small',
      2,
    )

    chunks.listToEmbed.mockResolvedValue(ok([]))
    usage.record.mockClear()
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)),
    ).toEqual({ embedded: 0, inputTokens: 0 })
    expect(usage.record).not.toHaveBeenCalled()
  })

  it('should skip when unavailable, over quota or with Steel AI off', async () => {
    platform.getEmbeddingsEnabled.mockResolvedValueOnce(false)
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)).skipped,
    ).toBe('disabled')

    usage.sumSince.mockResolvedValueOnce(ok(totals(50)))
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)).skipped,
    ).toBe('quota')

    settings.findByWorkspace.mockResolvedValueOnce(
      ok(createFakeWorkspaceAiSettings({ workspaceId: WS, aiEnabled: false })),
    )
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)).skipped,
    ).toBe('ai_disabled')

    // Unknown budget (database error): fail closed, no provider call.
    settings.findByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)).skipped,
    ).toBe('quota')
    usage.sumSince.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)).skipped,
    ).toBe('quota')
    expect(embed).not.toHaveBeenCalled()
  })

  it('should keep what was embedded when the provider fails mid-way', async () => {
    chunks.listToEmbed
      .mockResolvedValueOnce(ok(toEmbed(EMBED_PAGE_SIZE)))
      .mockResolvedValueOnce(ok(toEmbed(1, EMBED_PAGE_SIZE)))
    embed
      .mockImplementationOnce(async (texts) => vectors(texts.length, 7))
      .mockResolvedValueOnce(err(aiKnowledgeEmbeddingFailed()))
    expect(
      expectOk(await AiKnowledgeEmbeddingService.embedPending(WS)),
    ).toEqual({ embedded: EMBED_PAGE_SIZE, inputTokens: 7, skipped: 'failed' })
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 7 }),
    )
  })

  it('should propagate database errors (and still charge what was spent)', async () => {
    chunks.listToEmbed.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeEmbeddingService.embedPending(WS),
      'DATABASE_ERROR',
    )

    chunks.listToEmbed.mockResolvedValueOnce(ok(toEmbed(1)))
    chunks.saveEmbeddings.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiKnowledgeEmbeddingService.embedPending(WS),
      'DATABASE_ERROR',
    )
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 10 }),
    )
  })

  it('should log when the usage cannot be recorded', async () => {
    chunks.listToEmbed.mockResolvedValueOnce(ok(toEmbed(1)))
    usage.record.mockResolvedValueOnce(err(databaseError()))
    expectOk(await AiKnowledgeEmbeddingService.embedPending(WS))
    expect(logger.error).toHaveBeenCalledWith(
      'ai.knowledge.usage_record_failed',
      expect.any(Object),
    )
  })
})

describe('AiKnowledgeEmbeddingService.embedQuery', () => {
  it('should embed the query and charge the user', async () => {
    const result = await AiKnowledgeEmbeddingService.embedQuery(WS, 'u1', 'vpn')
    expect(result.reason).toBeNull()
    expect(result.vector?.startsWith('[')).toBe(true)
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', feature: 'KNOWLEDGE_SEARCH' }),
    )
  })

  it('should fall back to text with the reason', async () => {
    platform.getEmbeddingsEnabled.mockResolvedValueOnce(false)
    expect(
      await AiKnowledgeEmbeddingService.embedQuery(WS, 'u1', 'vpn'),
    ).toEqual({ vector: null, reason: 'disabled' })
    usage.sumSince.mockResolvedValueOnce(ok(totals(999)))
    expect(
      await AiKnowledgeEmbeddingService.embedQuery(WS, 'u1', 'vpn'),
    ).toEqual({ vector: null, reason: 'quota' })
    embed.mockResolvedValueOnce(err(aiKnowledgeEmbeddingFailed()))
    expect(
      await AiKnowledgeEmbeddingService.embedQuery(WS, 'u1', 'vpn'),
    ).toEqual({ vector: null, reason: 'failed' })
  })
})
