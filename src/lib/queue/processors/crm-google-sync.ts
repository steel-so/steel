import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  CrmGoogleSyncService,
  type SyncAllResult,
} from '@/src/services/crm-google-sync.service'
import { CrmGoogleSyncJob } from '../jobs'

/** Refreshes reviews (and metrics) of every connected Google Business Profile. */
export async function processCrmGoogleSync(job: Job): Promise<SyncAllResult> {
  switch (job.name) {
    case CrmGoogleSyncJob.RunTick: {
      const result = await CrmGoogleSyncService.syncAll()
      logger.info('queue.crm_google_sync.tick_completed', {
        component: 'Worker',
        jobId: job.id,
        processed: result.processed,
        synced: result.synced,
        failed: result.failed,
      })
      return result
    }
    default:
      throw new Error(
        `Unknown crm-google-sync job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
