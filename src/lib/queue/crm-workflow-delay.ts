import { logger } from '@/lib/axiom/logger'
import { CrmWorkflowDelayJob } from './jobs'
import { getCrmWorkflowDelayQueue } from './queues'

/**
 * Schedules the resume of a CRM workflow run paused on a delay step. BullMQ
 * keeps the job in its delayed set until `delayMs` has passed; the processor
 * (`processors/crm-workflow-delay.ts`) then continues the run.
 */
export async function enqueueCrmWorkflowResume(
  payload: { runId: string; stepId: string },
  delayMs: number,
): Promise<string> {
  const queue = getCrmWorkflowDelayQueue()
  const job = await queue.add(CrmWorkflowDelayJob.Resume, payload, {
    delay: Math.max(0, delayMs),
  })

  logger.info('queue.crm_workflow_delay.enqueued', {
    component: 'CrmWorkflowDelay',
    runId: payload.runId,
    stepId: payload.stepId,
    delayMs,
    jobId: job.id,
  })

  return job.id ?? ''
}
