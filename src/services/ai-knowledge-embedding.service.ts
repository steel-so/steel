import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  embedTexts,
  isEmbeddingProviderConfigured,
  KNOWLEDGE_EMBEDDING_MODEL,
  toVectorLiteral,
} from '@/src/lib/ai/knowledge/embeddings'
import { aiModelPricing } from '@/src/lib/ai/models'
import {
  currentPeriodStart,
  isQuotaExceeded,
  priceAiUsage,
} from '@/src/lib/ai/quota'
import { ok, type Result } from '@/src/lib/result'
import { toEmbeddingInput } from '@/src/mappers/ai-knowledge.mapper'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import {
  AiUsageRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

/**
 * The semantic half of the knowledge search (ADR 0037): whether it can run,
 * embedding the chunks the indexer wrote, and embedding a query. Every call
 * to the provider is priced like any other AI call (model price × platform
 * margin) and lands in the workspace AI usage as `KNOWLEDGE_SEARCH`; a
 * workspace over its monthly quota keeps a text-only search. Never fails
 * the caller for a provider problem: it logs and the search degrades.
 */

/** How long a process trusts its "is pgvector there?" answer. */
export const VECTOR_CHECK_TTL_MS = 5 * 60_000
/** Chunks embedded per provider round-trip by the indexer. */
export const EMBED_PAGE_SIZE = 64
/** Chunks one indexing pass embeds at most (the nightly pass catches up). */
export const EMBED_MAX_PER_RUN = 2_000

let vectorCheck: { value: boolean; expiresAt: number } | null = null

export type EmbeddingUnavailableReason =
  | 'disabled'
  | 'no_provider'
  | 'no_vector_index'

export interface EmbedPendingStats {
  embedded: number
  inputTokens: number
  /** Why nothing was embedded, when nothing could be. */
  skipped?: EmbeddingUnavailableReason | 'quota' | 'ai_disabled' | 'failed'
}

async function vectorIndexReady(now: number): Promise<boolean> {
  if (vectorCheck && vectorCheck.expiresAt > now) return vectorCheck.value
  const result = await AiKnowledgeChunkRepository.vectorEnabled()
  const value = result.ok && result.value
  vectorCheck = { value, expiresAt: now + VECTOR_CHECK_TTL_MS }
  return value
}

/** Workspace switch + quota, read once per call. */
async function workspaceBudget(
  workspaceId: string,
): Promise<'ok' | 'quota' | 'ai_disabled'> {
  const row = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
  if (!row.ok) return 'quota'
  const settings = toEffectiveAiSettings(row.value)
  if (!settings.aiEnabled) return 'ai_disabled'
  const used = await AiUsageRepository.sumSince(
    workspaceId,
    currentPeriodStart(),
  )
  if (!used.ok) return 'quota'
  return isQuotaExceeded(used.value.costUsd, settings.monthlyQuotaUsd)
    ? 'quota'
    : 'ok'
}

async function recordUsage(
  workspaceId: string,
  userId: string | null,
  inputTokens: number,
): Promise<void> {
  if (inputTokens <= 0) return
  const margin = await PlatformAiSettingsService.getCostMargin()
  const costUsd = priceAiUsage(
    aiModelPricing(KNOWLEDGE_EMBEDDING_MODEL),
    { inputTokens, outputTokens: 0 },
    margin,
  )
  const saved = await AiUsageRepository.record({
    workspaceId,
    userId,
    feature: 'KNOWLEDGE_SEARCH',
    provider: KNOWLEDGE_EMBEDDING_MODEL.provider,
    model: KNOWLEDGE_EMBEDDING_MODEL.model,
    inputTokens,
    outputTokens: 0,
    costUsd,
    module: null,
  })
  if (!saved.ok) {
    logger.error(
      'ai.knowledge.usage_record_failed',
      logFields(
        { component: 'AiKnowledgeEmbeddingService', workspaceId },
        { message: saved.error.message },
      ),
    )
  }
}

export const AiKnowledgeEmbeddingService = {
  /** Drops the cached pgvector check (tests, and after enabling it). */
  clearCache(): void {
    vectorCheck = null
  },

  /** `null` when embeddings can run, else why not. */
  async unavailableReason(
    now: number = Date.now(),
  ): Promise<EmbeddingUnavailableReason | null> {
    if (!(await PlatformAiSettingsService.getEmbeddingsEnabled(now))) {
      return 'disabled'
    }
    if (!isEmbeddingProviderConfigured()) return 'no_provider'
    if (!(await vectorIndexReady(now))) return 'no_vector_index'
    return null
  },

  /**
   * Embeds the workspace's chunks that have no current embedding, up to
   * `max`. Background work (`userId` null in the usage ledger).
   */
  async embedPending(
    workspaceId: string,
    max: number = EMBED_MAX_PER_RUN,
  ): Promise<Result<EmbedPendingStats>> {
    const unavailable = await AiKnowledgeEmbeddingService.unavailableReason()
    if (unavailable)
      return ok({ embedded: 0, inputTokens: 0, skipped: unavailable })
    const budget = await workspaceBudget(workspaceId)
    if (budget !== 'ok') {
      return ok({ embedded: 0, inputTokens: 0, skipped: budget })
    }

    let embedded = 0
    let inputTokens = 0
    while (embedded < max) {
      const page = await AiKnowledgeChunkRepository.listToEmbed(
        workspaceId,
        KNOWLEDGE_EMBEDDING_MODEL.model,
        Math.min(EMBED_PAGE_SIZE, max - embedded),
      )
      if (!page.ok) return page
      if (page.value.length === 0) break

      const vectors = await embedTexts(page.value.map(toEmbeddingInput))
      if (!vectors.ok) {
        await recordUsage(workspaceId, null, inputTokens)
        return ok({ embedded, inputTokens, skipped: 'failed' })
      }
      inputTokens += vectors.value.inputTokens
      const saved = await AiKnowledgeChunkRepository.saveEmbeddings(
        KNOWLEDGE_EMBEDDING_MODEL.model,
        page.value.map((chunk, i) => ({
          chunkId: chunk.id,
          workspaceId: chunk.workspaceId,
          contentHash: chunk.contentHash,
          vector: toVectorLiteral(vectors.value.vectors[i]),
        })),
      )
      if (!saved.ok) {
        await recordUsage(workspaceId, null, inputTokens)
        return saved
      }
      embedded += page.value.length
      if (page.value.length < EMBED_PAGE_SIZE) break
    }
    await recordUsage(workspaceId, null, inputTokens)
    return ok({ embedded, inputTokens })
  },

  /**
   * Vector literal of the query, or `null` (with the reason) when the
   * search must run on text only.
   */
  async embedQuery(
    workspaceId: string,
    userId: string,
    query: string,
  ): Promise<{ vector: string | null; reason: string | null }> {
    const unavailable = await AiKnowledgeEmbeddingService.unavailableReason()
    if (unavailable) return { vector: null, reason: unavailable }
    const budget = await workspaceBudget(workspaceId)
    if (budget !== 'ok') return { vector: null, reason: budget }
    const result = await embedTexts([query])
    if (!result.ok) return { vector: null, reason: 'failed' }
    await recordUsage(workspaceId, userId, result.value.inputTokens)
    return { vector: toVectorLiteral(result.value.vectors[0]), reason: null }
  },
}
