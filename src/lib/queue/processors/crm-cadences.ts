import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  type CadenceTickResult,
  CrmCadenceRunService,
} from '@/src/services/crm-cadence-run.service'
import { CrmCadencesJob } from '../jobs'

export async function processCrmCadences(job: Job): Promise<CadenceTickResult> {
  switch (job.name) {
    case CrmCadencesJob.RunTick: {
      const result = await CrmCadenceRunService.tick()
      if (!result.ok) {
        // Claim failed: throw so BullMQ retries; nothing was started.
        throw new Error(
          `Failed to run CRM cadences: ${result.error.code} (${result.error.message})`,
        )
      }
      if (result.value.claimed > 0) {
        logger.info('queue.crm_cadences.tick_completed', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-cadences job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
