import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { DocumentTrackingService } from '@/src/services/document-tracking.service'
import { DocumentsAnalyticsJob } from '../jobs'

type FlushResult = { sessions: number; sections: number; skipped: boolean }

/**
 * `documents-analytics` (every minute): moves the reading buffer of the
 * public document links from Redis to `document_sessions` and
 * `document_section_stats` (ADR 0063). A failed write fails the job; the
 * batch stays in Redis and the next minute's run applies it.
 */
export async function processDocumentsAnalytics(
  job: Job,
): Promise<FlushResult> {
  switch (job.name) {
    case DocumentsAnalyticsJob.Flush: {
      const result = await DocumentTrackingService.flush()
      if (!result.ok) {
        throw new Error(
          `Failed to flush document analytics: ${result.error.code} (${result.error.message})`,
        )
      }
      if (result.value.sessions > 0) {
        logger.info('queue.documents_analytics.flushed', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    default:
      throw new Error(
        `Unknown documents-analytics job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
