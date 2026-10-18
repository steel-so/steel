import { logger } from '@/lib/axiom/logger'
import { AiIndexJob } from '@/src/lib/queue/jobs'
import { getAiIndexQueue } from '@/src/lib/queue/queues'
import type { SearchEntityType } from '@/src/lib/search/search-entities'
import { AiKnowledgeIndexService } from '@/src/services/ai-knowledge-index.service'
import type { KnowledgeSourceType } from './sources'

/**
 * Fire-and-forget maintenance of the Steel AI knowledge index (ADR 0037),
 * called by the domain services right after a successful write. Never
 * awaited by the caller and never throws: a failure only logs — the
 * business operation already succeeded and the nightly `ai-index` reindex
 * repairs whatever was missed.
 *
 * Writes are debounced per source: a Wiki page autosaves on every pause in
 * typing, and only the last save of a burst is worth re-chunking and
 * re-embedding. Deletions skip the queue (LGPD: the chunks go at once).
 */

/** Quiet period before a touched source is re-indexed. */
export const KNOWLEDGE_INDEX_DEBOUNCE_MS = 30_000

/** Global-search entity types whose writes also feed the knowledge index. */
const FROM_SEARCH_ENTITY: Partial<
  Record<SearchEntityType, KnowledgeSourceType>
> = {
  'sd-kb-article': 'sd-kb-article',
  'sd-ticket': 'sd-ticket',
  'crm-proposal': 'crm-proposal',
}

/** Knowledge source fed by a global-search entity type, if any. */
export function knowledgeSourceOfSearchEntity(
  type: SearchEntityType,
): KnowledgeSourceType | null {
  return FROM_SEARCH_ENTITY[type] ?? null
}

function idsOf(id: string | readonly string[]): string[] {
  return [...new Set(typeof id === 'string' ? [id] : id)].filter(Boolean)
}

function logFailure(
  op: string,
  workspaceId: string,
  sourceType: string | null,
  error: unknown,
): void {
  logger.warn('ai.knowledge.hook_failed', {
    component: 'AiKnowledgeIndex',
    op,
    workspaceId,
    ...(sourceType && { sourceType }),
    error: error instanceof Error ? error.message : String(error),
  })
}

/** Re-indexes the source(s) after the debounce window. */
export async function scheduleKnowledgeIndex(
  sourceType: KnowledgeSourceType,
  workspaceId: string,
  sourceId: string | readonly string[],
): Promise<void> {
  const ids = idsOf(sourceId)
  if (ids.length === 0) return
  try {
    const queue = getAiIndexQueue()
    await Promise.all(
      ids.map((id) => {
        const key = `${workspaceId}-${sourceType}-${id}`
        return queue.add(
          AiIndexJob.Refresh,
          { workspaceId, sourceType, sourceIds: [id] },
          {
            delay: KNOWLEDGE_INDEX_DEBOUNCE_MS,
            // Debounce: a newer write replaces the waiting job and restarts
            // the window.
            deduplication: {
              id: `ai-index-${key}`,
              ttl: KNOWLEDGE_INDEX_DEBOUNCE_MS,
              extend: true,
              replace: true,
            },
          },
        )
      }),
    )
  } catch (error) {
    logFailure('schedule', workspaceId, sourceType, error)
  }
}

/** Drops the source(s) from the index now (hard or soft delete). */
export async function removeKnowledgeSource(
  sourceType: KnowledgeSourceType,
  workspaceId: string,
  sourceId: string | readonly string[],
): Promise<void> {
  const ids = idsOf(sourceId)
  if (ids.length === 0) return
  try {
    const result = await AiKnowledgeIndexService.remove(
      sourceType,
      workspaceId,
      ids,
    )
    if (!result.ok)
      logFailure('remove', workspaceId, sourceType, result.error.code)
  } catch (error) {
    logFailure('remove', workspaceId, sourceType, error)
  }
}

/**
 * Rebuilds the workspace's index (or only some source types) in the
 * background — e.g. archiving a Wiki page also archives its sub-pages.
 */
export async function scheduleKnowledgeReindex(
  workspaceId: string,
  sourceTypes?: readonly KnowledgeSourceType[],
): Promise<void> {
  try {
    const scope = sourceTypes?.length ? [...sourceTypes].sort() : []
    await getAiIndexQueue().add(
      AiIndexJob.ReindexWorkspace,
      { workspaceId, ...(scope.length && { sourceTypes: scope }) },
      {
        deduplication: {
          id: `ai-index-reindex-${workspaceId}-${scope.join('+') || 'all'}`,
          ttl: KNOWLEDGE_INDEX_DEBOUNCE_MS,
        },
      },
    )
  } catch (error) {
    logFailure('reindex', workspaceId, sourceTypes?.join(',') ?? null, error)
  }
}

/**
 * Steel AI switched on/off in Ajustes › Steel IA. Off purges the
 * workspace's chunks at once (nothing more is sent to the embedding
 * provider); on rebuilds the index in the background.
 */
export async function onWorkspaceAiSwitch(
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  try {
    if (!enabled) {
      const result = await AiKnowledgeIndexService.purgeWorkspace(workspaceId)
      if (!result.ok) logFailure('purge', workspaceId, null, result.error.code)
      return
    }
    await scheduleKnowledgeReindex(workspaceId)
  } catch (error) {
    logFailure('purge', workspaceId, null, error)
  }
}
