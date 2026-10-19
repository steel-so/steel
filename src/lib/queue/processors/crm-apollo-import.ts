import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { CrmApolloImportRunner } from '@/src/services/crm-apollo-import-runner.service'
import { CrmApolloImportJob, type CrmApolloImportJobPayload } from '../jobs'

type RunResult = { state: string } | { error: string }

/**
 * Runs one Apollo import. Domain failures are written on the import row and
 * returned, never thrown: the queue has `attempts: 1`, because a batch that
 * already spent Apollo credits must not be repeated.
 */
export async function processCrmApolloImport(job: Job): Promise<RunResult> {
  switch (job.name) {
    case CrmApolloImportJob.Run: {
      const { importId } = job.data as CrmApolloImportJobPayload['run-import']
      const result = await CrmApolloImportRunner.run(importId)
      if (!result.ok) {
        logger.error('queue.crm_apollo_import.failed', {
          component: 'Worker',
          jobId: job.id,
          importId,
          code: result.error.code,
        })
        return { error: result.error.code }
      }
      logger.info('queue.crm_apollo_import.processed', {
        component: 'Worker',
        jobId: job.id,
        importId,
        state: result.value.state,
      })
      return { state: result.value.state }
    }
    default:
      throw new Error(
        `Unknown crm-apollo-import job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
