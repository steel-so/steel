import type { ModuleKind } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { bestChunkPerSource, fuseRankings } from '@/src/lib/ai/knowledge/fusion'
import {
  KNOWLEDGE_SOURCES,
  type KnowledgeSourceType,
} from '@/src/lib/ai/knowledge/sources'
import {
  REPLY_KNOWLEDGE_MAX_SOURCES,
  type ReplyKnowledgeEntry,
} from '@/src/lib/whatsapp/reply-knowledge'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { WikiSettingsRepository } from '@/src/repositories/wiki-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { AiKnowledgeSearchService } from './ai-knowledge-search.service'

/**
 * Retrieval of KB articles and Wiki pages for the WhatsApp AI, through the
 * unified knowledge index (ADR 0037). Both paths are best effort: any
 * failure logs and returns no entries, so a reply is never blocked by the
 * knowledge lookup.
 *
 * - `forCustomerReply` (auto-reply, no logged-in user): the answer goes to
 *   an end customer, so only what is meant for people outside the team is
 *   eligible — KB articles visible in the portal (chunk audience PUBLIC)
 *   and Wiki pages with a public link. Internal articles and unpublished
 *   Wiki pages never reach the prompt.
 * - `forAgent` (copilot): the human agent reviews the draft before sending,
 *   so the search runs as that agent and follows their permissions
 *   (`AiKnowledgeSearchService`).
 */

const CANDIDATES = 20
const SOURCES: KnowledgeSourceType[] = ['sd-kb-article', 'wiki-page']

export const WhatsAppReplyKnowledgeService = {
  async forCustomerReply(
    workspaceId: string,
    query: string,
  ): Promise<ReplyKnowledgeEntry[]> {
    const q = query.trim()
    if (q.length < 2) return []
    try {
      const settings =
        await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
      if (!settings.ok || !toEffectiveAiSettings(settings.value).aiEnabled) {
        return []
      }
      const [modules, wiki] = await Promise.all([
        WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
        WikiSettingsRepository.isEnabled(workspaceId),
      ])
      if (!modules.ok || !wiki.ok) return []
      const enabled = new Set<ModuleKind>(
        modules.value.filter((m) => m.enabled).map((m) => m.module),
      )
      const types = SOURCES.filter((type) => {
        const meta = KNOWLEDGE_SOURCES[type]
        if (meta.module && !enabled.has(meta.module)) return false
        return meta.gate !== 'wiki' || wiki.value
      })
      if (types.length === 0) return []

      const hits = await AiKnowledgeChunkRepository.searchText({
        workspaceId,
        // No user: PUBLIC chunks only (never PARTIES/AGENTS).
        userId: '',
        types,
        isSdAgent: false,
        limit: CANDIDATES,
        text: q,
      })
      if (!hits.ok || hits.value.length === 0) return []

      const wikiIds = [
        ...new Set(
          hits.value
            .filter((h) => h.sourceType === 'wiki-page')
            .map((h) => h.sourceId),
        ),
      ]
      const published = await WikiPageRepository.listPublishedIds(
        workspaceId,
        wikiIds,
      )
      if (!published.ok) return []

      const allowed = hits.value.filter(
        (h) => h.sourceType !== 'wiki-page' || published.value.has(h.sourceId),
      )
      const best = bestChunkPerSource(
        fuseRankings(allowed, []),
        REPLY_KNOWLEDGE_MAX_SOURCES,
      )
      return best.map(({ chunk }) => ({
        sourceLabel: KNOWLEDGE_SOURCES[chunk.sourceType].label,
        title: chunk.title,
        text: chunk.content,
      }))
    } catch (error) {
      logger.warn('whatsapp.reply_knowledge.failed', {
        component: 'WhatsAppReplyKnowledgeService',
        audience: 'customer',
        workspaceId,
        reason: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  },

  async forAgent(
    actorId: string,
    workspaceId: string,
    query: string,
  ): Promise<ReplyKnowledgeEntry[]> {
    const q = query.trim()
    if (q.length < 2) return []
    try {
      const found = await AiKnowledgeSearchService.search(actorId, workspaceId, {
        q,
        sources: SOURCES,
        limit: REPLY_KNOWLEDGE_MAX_SOURCES,
      })
      if (!found.ok) return []
      return found.value.results.map((r) => ({
        sourceLabel: r.sourceLabel,
        title: r.title,
        text: r.snippet,
      }))
    } catch (error) {
      logger.warn('whatsapp.reply_knowledge.failed', {
        component: 'WhatsAppReplyKnowledgeService',
        audience: 'agent',
        workspaceId,
        reason: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  },
}
