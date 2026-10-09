import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  type CrmWorkflowDelayOutcome,
  resumeCrmWorkflowAfterDelay,
} from '@/src/services/crm-workflow-runner'
import { CrmWorkflowDelayJob, type CrmWorkflowDelayJobPayload } from '../jobs'

/**
 * BullMQ calls a processor as `(job, lockToken)`, so the clock can't be an
 * optional second parameter of the registered function (see usage-rollup).
 */
export function processCrmWorkflowDelay(
  job: Job,
): Promise<CrmWorkflowDelayOutcome> {
  return runCrmWorkflowDelayJob(job, () => new Date())
}

export async function runCrmWorkflowDelayJob(
  job: Job,
  clock: () => Date,
): Promise<CrmWorkflowDelayOutcome> {
  switch (job.name) {
    case CrmWorkflowDelayJob.Resume: {
      const payload =
        job.data as CrmWorkflowDelayJobPayload[typeof CrmWorkflowDelayJob.Resume]
      const outcome = await resumeCrmWorkflowAfterDelay(payload, clock)
      logger.info('queue.crm_workflow_delay.processed', {
        component: 'Worker',
        jobId: job.id,
        runId: payload.runId,
        stepId: payload.stepId,
        outcome,
      })
      return outcome
    }
    default:
      throw new Error(
        `Unknown crm-workflow-delay job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
