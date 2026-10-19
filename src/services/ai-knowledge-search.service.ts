import type { ModuleKind } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { aiDisabled } from '@/src/errors/app-error'
import { KNOWLEDGE_EMBEDDING_MODEL } from '@/src/lib/ai/knowledge/embeddings'
import {
  bestChunkPerSource,
  type FusedChunk,
  fuseRankings,
} from '@/src/lib/ai/knowledge/fusion'
import {
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_SOURCES,
  type KnowledgeSourceType,
} from '@/src/lib/ai/knowledge/sources'
import type {
  KnowledgeChunkHit,
  KnowledgeChunkQuery,
} from '@/src/lib/ai/knowledge/types'
import { can } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { toAiKnowledgeResultDTO } from '@/src/mappers/ai-knowledge.mapper'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { SearchSourceRepository } from '@/src/repositories/search-source.repository'
import { WikiSettingsRepository } from '@/src/repositories/wiki-settings.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  AI_KNOWLEDGE_DEFAULT_LIMIT,
  type AiKnowledgeSearchInput,
} from '@/src/schemas/ai-knowledge.schema'
import type { AiKnowledgeSearchResponseDTO } from '@/types/ai-knowledge'
import { AiKnowledgeEmbeddingService } from './ai-knowledge-embedding.service'
import { assertMember } from './authz'
import { SdAccess } from './sd-access'

/**
 * Steel AI knowledge search (ADR 0037): hybrid retrieval over the chunks
 * of KB articles, Wiki pages, resolved tickets, WhatsApp AI documents, CRM
 * notes and proposals. Authorization is decided here, per source type,
 * before any query runs, with the rule of each source's own service:
 * membership → Steel AI on → module enabled → the source gate (Wiki on,
 * OWNER/ADMIN for the WhatsApp AI documents, ServiceDesk agent or
 * requester) → RBAC `VIEW`. The repository then filters by that
 * allow-list and by `audience` inside the SQL, and requester tickets are
 * re-checked against the live rows.
 */

/** Candidates fetched from each retrieval before the fusion. */
export const KNOWLEDGE_CANDIDATES = 40
/**
 * Below this cosine similarity a vector-only match is noise for
 * text-embedding-3-small (unrelated pt-BR texts sit around 0.1–0.2).
 */
export const KNOWLEDGE_MIN_SIMILARITY = 0.25

export interface KnowledgeAccess {
  types: KnowledgeSourceType[]
  isSdAgent: boolean
  slug: string
}

/** Words of the query, for the snippet window (no SQL involved). */
function queryWords(q: string): string[] {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
}

export const AiKnowledgeSearchService = {
  /** Which source types `actorId` may search in this workspace. */
  async resolveAccess(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<KnowledgeAccess>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const settings =
      await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
    if (!settings.ok) return settings
    if (!toEffectiveAiSettings(settings.value).aiEnabled) {
      return err(aiDisabled())
    }

    const [workspace, modules, wiki] = await Promise.all([
      WorkspaceRepository.findById(workspaceId),
      WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
      WikiSettingsRepository.isEnabled(workspaceId),
    ])
    if (!workspace.ok) return workspace
    if (!modules.ok) return modules
    if (!wiki.ok) return wiki
    const enabled = new Set<ModuleKind>(
      modules.value.filter((m) => m.enabled).map((m) => m.module),
    )

    let isSdAgent = false
    if (enabled.has('SERVICE_DESK')) {
      const sd = await SdAccess.resolve(actorId, workspaceId)
      if (!sd.ok) return sd
      isSdAgent = sd.value.isAgent
    }

    const { isPrivileged, permissions } = membership.value
    const types = KNOWLEDGE_SOURCE_TYPES.filter((type) => {
      const meta = KNOWLEDGE_SOURCES[type]
      if (meta.module && !enabled.has(meta.module)) return false
      if (meta.gate === 'wiki' && !wiki.value) return false
      if (meta.gate === 'privileged' && !isPrivileged) return false
      if (!meta.resource || isPrivileged) return true
      return permissions !== null && can(permissions, meta.resource, 'VIEW')
    })

    return ok({ types, isSdAgent, slug: workspace.value.slug })
  },

  async search(
    actorId: string,
    workspaceId: string,
    input: AiKnowledgeSearchInput,
  ): Promise<Result<AiKnowledgeSearchResponseDTO>> {
    const startedAt = Date.now()
    const limit = input.limit ?? AI_KNOWLEDGE_DEFAULT_LIMIT
    const access = await AiKnowledgeSearchService.resolveAccess(
      actorId,
      workspaceId,
    )
    if (!access.ok) return access

    const q = input.q.trim()
    const types = input.sources
      ? access.value.types.filter((t) => input.sources?.includes(t))
      : access.value.types
    if (q.length < 2 || types.length === 0) {
      return ok({
        query: input.q,
        mode: 'text',
        results: [],
        tookMs: Date.now() - startedAt,
      })
    }

    const base: KnowledgeChunkQuery = {
      workspaceId,
      userId: actorId,
      types,
      isSdAgent: access.value.isSdAgent,
      limit: KNOWLEDGE_CANDIDATES,
    }
    const [textHits, embedding] = await Promise.all([
      AiKnowledgeChunkRepository.searchText({ ...base, text: q }),
      AiKnowledgeEmbeddingService.embedQuery(workspaceId, actorId, q),
    ])
    if (!textHits.ok) return textHits

    let vectorHits: KnowledgeChunkHit[] = []
    let fallback = embedding.reason
    if (embedding.vector) {
      const found = await AiKnowledgeChunkRepository.searchVector({
        ...base,
        vector: embedding.vector,
        model: KNOWLEDGE_EMBEDDING_MODEL.model,
      })
      if (found.ok) {
        vectorHits = found.value.filter(
          (hit) => hit.score >= KNOWLEDGE_MIN_SIMILARITY,
        )
      } else {
        // The text half already answered; degrade instead of failing.
        fallback = 'vector_query_failed'
        logger.warn('ai.knowledge.vector_search_failed', {
          component: 'AiKnowledgeSearchService',
          workspaceId,
          code: found.error.code,
        })
      }
    }
    const mode = embedding.vector && !fallback ? 'hybrid' : 'text'

    const fused = fuseRankings(textHits.value, vectorHits)
    const visible = await AiKnowledgeSearchService.dropUnviewableTickets(
      actorId,
      workspaceId,
      access.value.isSdAgent,
      fused,
    )
    if (!visible.ok) return visible
    const best = bestChunkPerSource(visible.value, limit)

    const tookMs = Date.now() - startedAt
    // Never log the query itself: it may carry a name, phone or e-mail.
    logger.info('ai.knowledge.search', {
      component: 'AiKnowledgeSearchService',
      workspaceId,
      mode,
      ...(fallback && { fallback }),
      queryLength: q.length,
      types: types.length,
      textCandidates: textHits.value.length,
      vectorCandidates: vectorHits.length,
      results: best.length,
      tookMs,
    })

    const words = queryWords(q)
    return ok({
      query: input.q,
      mode,
      results: best.map((entry) =>
        toAiKnowledgeResultDTO(entry, access.value.slug, words),
      ),
      tookMs,
    })
  },

  /**
   * Second gate for requesters: re-checks each ticket against the live row
   * (requester, participants, linked contact — `canViewSdTicket`), so a
   * stale chunk never cites a ticket the requester can no longer open.
   */
  async dropUnviewableTickets(
    actorId: string,
    workspaceId: string,
    isSdAgent: boolean,
    fused: FusedChunk<KnowledgeChunkHit>[],
  ): Promise<Result<FusedChunk<KnowledgeChunkHit>[]>> {
    const ids = [
      ...new Set(
        fused
          .filter((f) => f.chunk.sourceType === 'sd-ticket')
          .map((f) => f.chunk.sourceId),
      ),
    ]
    if (isSdAgent || ids.length === 0) return ok(fused)
    const rows = await SearchSourceRepository.sdTickets(workspaceId, {
      ids,
      take: ids.length,
    })
    if (!rows.ok) return rows
    const allowed = new Set(
      rows.value
        .filter(
          (row) =>
            row.requesterId === actorId ||
            row.participants.some((p) => p.userId === actorId) ||
            row.contact?.userId === actorId,
        )
        .map((row) => row.id),
    )
    return ok(
      fused.filter(
        (f) =>
          f.chunk.sourceType !== 'sd-ticket' || allowed.has(f.chunk.sourceId),
      ),
    )
  },
}
