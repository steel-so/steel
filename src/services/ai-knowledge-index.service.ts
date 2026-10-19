import { logger } from '@/lib/axiom/logger'
import {
  KNOWLEDGE_SOURCE_TYPES,
  type KnowledgeSourceType,
} from '@/src/lib/ai/knowledge/sources'
import type { KnowledgeDocument } from '@/src/lib/ai/knowledge/types'
import { ok, type Result } from '@/src/lib/result'
import {
  toCrmNoteKnowledge,
  toCrmProposalKnowledge,
  toKbArticleKnowledge,
  toKnowledgeChunks,
  toTicketKnowledge,
  toWikiPageKnowledge,
  toZapDocumentKnowledge,
} from '@/src/mappers/ai-knowledge.mapper'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import {
  AiKnowledgeSourceRepository,
  type KnowledgeSourceOptions,
} from '@/src/repositories/ai-knowledge-source.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import {
  AiKnowledgeEmbeddingService,
  type EmbedPendingStats,
} from './ai-knowledge-embedding.service'

/**
 * Keeps `ai_knowledge_chunks` in sync with the sources (ADR 0037).
 * `refresh` is what the debounced `ai-index` job runs after a write
 * (sources the loader no longer returns — deleted, archived, reopened —
 * lose their chunks); `reindex*` is the backfill/nightly path, which also
 * drops chunks of sources it did not see. Both then embed what is missing.
 *
 * A workspace with Steel AI switched off is never indexed: its chunks are
 * deleted instead, and nothing is sent to the embedding provider.
 */

type Loader = (
  workspaceId: string,
  opts: KnowledgeSourceOptions,
) => Promise<Result<KnowledgeDocument[]>>

function simple<Row>(
  load: (ws: string, opts: KnowledgeSourceOptions) => Promise<Result<Row[]>>,
  build: (ws: string, row: Row) => KnowledgeDocument,
): Loader {
  return async (ws, opts) => {
    const rows = await load(ws, opts)
    if (!rows.ok) return rows
    return ok(rows.value.map((row) => build(ws, row)))
  }
}

const LOADERS: Record<KnowledgeSourceType, Loader> = {
  'sd-kb-article': simple(
    (ws, o) => AiKnowledgeSourceRepository.kbArticles(ws, o),
    toKbArticleKnowledge,
  ),
  'wiki-page': simple(
    (ws, o) => AiKnowledgeSourceRepository.wikiPages(ws, o),
    toWikiPageKnowledge,
  ),
  'sd-ticket': async (ws, opts) => {
    const prefixes = await AiKnowledgeSourceRepository.ticketPrefixes(ws)
    if (!prefixes.ok) return prefixes
    const rows = await AiKnowledgeSourceRepository.resolvedTickets(ws, opts)
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) => toTicketKnowledge(ws, row, prefixes.value)),
    )
  },
  'zap-knowledge-doc': simple(
    (ws, o) => AiKnowledgeSourceRepository.zapDocuments(ws, o),
    toZapDocumentKnowledge,
  ),
  'crm-note': simple(
    (ws, o) => AiKnowledgeSourceRepository.crmNotes(ws, o),
    toCrmNoteKnowledge,
  ),
  'crm-proposal': simple(
    (ws, o) => AiKnowledgeSourceRepository.crmProposals(ws, o),
    toCrmProposalKnowledge,
  ),
}

/** Sources per loader call and per chunk write of the backfill. */
export const KNOWLEDGE_REINDEX_BATCH = 200
const WORKSPACE_BATCH = 100

export interface KnowledgeIndexStats {
  /** Sources written (with or without text). */
  indexed: number
  /** Sources whose chunks were dropped. */
  removed: number
  embedded: number
  /** Workspace with Steel AI off: purged instead of indexed. */
  purged?: boolean
}

export interface KnowledgeReindexAllStats {
  workspaces: number
  failed: number
  indexed: number
  removed: number
  embedded: number
  vectorIndexReady: boolean
}

async function aiEnabled(workspaceId: string): Promise<Result<boolean>> {
  const row = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
  if (!row.ok) return row
  return ok(toEffectiveAiSettings(row.value).aiEnabled)
}

async function write(
  workspaceId: string,
  sourceType: KnowledgeSourceType,
  docs: readonly KnowledgeDocument[],
): Promise<Result<number>> {
  return AiKnowledgeChunkRepository.replaceSources(
    workspaceId,
    sourceType,
    docs.map((doc) => ({
      sourceId: doc.sourceId,
      chunks: toKnowledgeChunks(doc),
    })),
  )
}

/** Embedding problems never fail indexing: the text half is already in. */
async function embed(workspaceId: string): Promise<EmbedPendingStats> {
  const result = await AiKnowledgeEmbeddingService.embedPending(workspaceId)
  if (result.ok) return result.value
  logger.warn('ai.knowledge.embed_failed', {
    component: 'AiKnowledgeIndexService',
    workspaceId,
    code: result.error.code,
  })
  return { embedded: 0, inputTokens: 0, skipped: 'failed' }
}

export const AiKnowledgeIndexService = {
  async refresh(
    sourceType: KnowledgeSourceType,
    workspaceId: string,
    sourceIds: readonly string[],
  ): Promise<Result<KnowledgeIndexStats>> {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (ids.length === 0) return ok({ indexed: 0, removed: 0, embedded: 0 })

    const enabled = await aiEnabled(workspaceId)
    if (!enabled.ok) return enabled
    if (!enabled.value)
      return AiKnowledgeIndexService.purgeWorkspace(workspaceId)

    const docs = await LOADERS[sourceType](workspaceId, {
      ids,
      take: ids.length,
    })
    if (!docs.ok) return docs
    const written = await write(workspaceId, sourceType, docs.value)
    if (!written.ok) return written

    const found = new Set(docs.value.map((d) => d.sourceId))
    const missing = ids.filter((id) => !found.has(id))
    const removed = await AiKnowledgeChunkRepository.removeSources(
      workspaceId,
      sourceType,
      missing,
    )
    if (!removed.ok) return removed

    const embedded = await embed(workspaceId)
    return ok({
      indexed: docs.value.length,
      removed: missing.length,
      embedded: embedded.embedded,
    })
  },

  /** Drops the sources' chunks right away (LGPD: deletion). */
  remove(
    sourceType: KnowledgeSourceType,
    workspaceId: string,
    sourceIds: readonly string[],
  ): Promise<Result<number>> {
    return AiKnowledgeChunkRepository.removeSources(
      workspaceId,
      sourceType,
      sourceIds,
    )
  },

  /** Steel AI switched off: the workspace leaves the index entirely. */
  async purgeWorkspace(
    workspaceId: string,
  ): Promise<Result<KnowledgeIndexStats>> {
    const removed =
      await AiKnowledgeChunkRepository.removeWorkspace(workspaceId)
    if (!removed.ok) return removed
    logger.info('ai.knowledge.workspace_purged', {
      component: 'AiKnowledgeIndexService',
      workspaceId,
      chunks: removed.value,
    })
    return ok({ indexed: 0, removed: removed.value, embedded: 0, purged: true })
  },

  /**
   * Full rebuild of one workspace (all source types, or the given ones):
   * pages through every source, then removes what this pass did not touch.
   */
  async reindexWorkspace(
    workspaceId: string,
    types: readonly KnowledgeSourceType[] = KNOWLEDGE_SOURCE_TYPES,
  ): Promise<Result<KnowledgeIndexStats>> {
    const enabled = await aiEnabled(workspaceId)
    if (!enabled.ok) return enabled
    if (!enabled.value)
      return AiKnowledgeIndexService.purgeWorkspace(workspaceId)

    const startedAt = await AiKnowledgeChunkRepository.now()
    if (!startedAt.ok) return startedAt
    let indexed = 0
    let removed = 0
    for (const type of types) {
      let afterId: string | undefined
      for (;;) {
        const docs = await LOADERS[type](workspaceId, {
          afterId,
          take: KNOWLEDGE_REINDEX_BATCH,
        })
        if (!docs.ok) return docs
        const written = await write(workspaceId, type, docs.value)
        if (!written.ok) return written
        indexed += docs.value.length
        if (docs.value.length < KNOWLEDGE_REINDEX_BATCH) break
        afterId = docs.value[docs.value.length - 1].sourceId
      }
      const stale = await AiKnowledgeChunkRepository.removeStale(
        workspaceId,
        type,
        startedAt.value,
      )
      if (!stale.ok) return stale
      removed += stale.value
    }
    const embedded = await embed(workspaceId)
    return ok({ indexed, removed, embedded: embedded.embedded })
  },

  /**
   * Nightly job (and `pnpm ai:index` without a workspace): turns the vector
   * sidecar on if pgvector appeared, then reindexes every workspace with
   * Steel AI on. One failing workspace does not stop the run.
   */
  async reindexAll(): Promise<Result<KnowledgeReindexAllStats>> {
    const vector = await AiKnowledgeChunkRepository.enableVector()
    AiKnowledgeEmbeddingService.clearCache()
    // Catches a switch-off whose purge hook failed.
    const purged = await AiKnowledgeChunkRepository.removeAiDisabled()
    if (!purged.ok) return purged
    const stats: KnowledgeReindexAllStats = {
      workspaces: 0,
      failed: 0,
      indexed: 0,
      removed: purged.value,
      embedded: 0,
      vectorIndexReady: vector.ok && vector.value,
    }
    let afterId: string | undefined
    for (;;) {
      const ids = await AiKnowledgeSourceRepository.aiEnabledWorkspaceIds(
        afterId,
        WORKSPACE_BATCH,
      )
      if (!ids.ok) return ids
      for (const workspaceId of ids.value) {
        const result =
          await AiKnowledgeIndexService.reindexWorkspace(workspaceId)
        stats.workspaces++
        if (!result.ok) {
          stats.failed++
          logger.error('ai.knowledge.reindex_workspace_failed', {
            component: 'AiKnowledgeIndexService',
            workspaceId,
            code: result.error.code,
          })
          continue
        }
        stats.indexed += result.value.indexed
        stats.removed += result.value.removed
        stats.embedded += result.value.embedded
      }
      if (ids.value.length < WORKSPACE_BATCH) break
      afterId = ids.value[ids.value.length - 1]
    }
    return ok(stats)
  },
}
