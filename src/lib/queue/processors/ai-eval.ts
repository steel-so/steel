import type { Job } from 'bullmq'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { executeAiEvalRun } from '@/src/services/ai-eval-runner'
import { AiEvalJob, type AiEvalJobPayload } from '../jobs'

/** Queue `ai-eval`: `run` answers and grades every case of one eval run. */
export async function processAiEval(job: Job): Promise<unknown> {
  if (job.name !== AiEvalJob.Run) {
    throw new Error(
      `Unknown ai-eval job: ${job.name} (id=${job.id ?? 'unknown'})`,
    )
  }
  const { runId } = job.data as AiEvalJobPayload['run']
  const result = await executeAiEvalRun(runId)
  if (!result.ok) {
    throw new Error(
      `ai-eval run ${runId} failed: ${result.error.code} ${result.error.message}`,
    )
  }
  logger.info(
    'queue.ai_eval.run_completed',
    logFields(
      { component: 'Worker' },
      { jobId: job.id, runId, outcome: result.value },
    ),
  )
  return result.value
}
