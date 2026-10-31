import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  CrmDuplicateService,
  type ScheduledScanResult,
} from '@/src/services/crm-duplicate.service'
import { CrmDuplicatesJob } from '../jobs'

export async function processCrmDuplicates(
  job: Job,
): Promise<ScheduledScanResult> {
  switch (job.name) {
    case CrmDuplicatesJob.RunScan: {
      const result = await CrmDuplicateService.runScheduled()
      if (!result.ok) {
        throw new Error(
          `Failed to scan CRM duplicates: ${result.error.code} (${result.error.message})`,
        )
      }
      logger.info('queue.crm_duplicates.scan_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-duplicates job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
