import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { isKnowledgeSourceType } from '@/src/lib/ai/knowledge/sources'
import { AiKnowledgeIndexService } from '@/src/services/ai-knowledge-index.service'
import { AiIndexJob, type AiIndexJobPayload } from '../jobs'

/** Steel AI knowledge index (ADR 0037). Throws only to let BullMQ retry. */
export async function processAiIndex(job: Job): Promise<unknown> {
  switch (job.name) {
    case AiIndexJob.Refresh: {
      const { workspaceId, sourceType, sourceIds } =
        job.data as AiIndexJobPayload[typeof AiIndexJob.Refresh]
      if (!isKnowledgeSourceType(sourceType)) {
        // A payload from a newer/older deploy: nothing to retry.
        logger.warn('queue.ai_index.unknown_source_type', {
          component: 'Worker',
          jobId: job.id,
          sourceType,
        })
        return { skipped: true }
      }
      const result = await AiKnowledgeIndexService.refresh(
        sourceType,
        workspaceId,
        sourceIds,
      )
      if (!result.ok) {
        throw new Error(
          `Failed to refresh the knowledge index (${sourceType}) for workspace ${workspaceId}: ${result.error.code}`,
        )
      }
      logger.info('queue.ai_index.refreshed', {
        component: 'Worker',
        jobId: job.id,
        workspaceId,
        sourceType,
        ...result.value,
      })
      return result.value
    }
    case AiIndexJob.ReindexWorkspace: {
      const { workspaceId, sourceTypes } =
        job.data as AiIndexJobPayload[typeof AiIndexJob.ReindexWorkspace]
      const types = sourceTypes?.filter(isKnowledgeSourceType)
      const result = await AiKnowledgeIndexService.reindexWorkspace(
        workspaceId,
        types?.length ? types : undefined,
      )
      if (!result.ok) {
        throw new Error(
          `Failed to reindex the knowledge of workspace ${workspaceId}: ${result.error.code}`,
        )
      }
      logger.info('queue.ai_index.workspace_reindexed', {
        component: 'Worker',
        jobId: job.id,
        workspaceId,
        ...result.value,
      })
      return result.value
    }
    case AiIndexJob.ReindexAll: {
      const result = await AiKnowledgeIndexService.reindexAll()
      if (!result.ok) {
        throw new Error(
          `Failed to reindex the knowledge index: ${result.error.code} (${result.error.message})`,
        )
      }
      logger.info('queue.ai_index.completed', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown ai-index job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
