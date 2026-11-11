import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  DocumentExpiryService,
  type DocumentExpiryTick,
} from '@/src/services/document-expiry.service'
import { DocumentsExpiryJob } from '../jobs'

/** Daily expiry of sent documents (ADR 0063). */
export async function processDocumentsExpiry(
  job: Job,
): Promise<DocumentExpiryTick> {
  switch (job.name) {
    case DocumentsExpiryJob.RunTick: {
      const result = await DocumentExpiryService.expireDue()
      if (!result.ok) {
        // Batch read failed: throw so BullMQ retries.
        throw new Error(
          `Failed to expire documents: ${result.error.code} (${result.error.message})`,
        )
      }
      logger.info('queue.documents_expiry.tick_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown documents-expiry job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
