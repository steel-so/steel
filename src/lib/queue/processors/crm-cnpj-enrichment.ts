import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { CrmCnpjEnrichmentRunner } from '@/src/services/crm-cnpj-enrichment-runner.service'
import { CrmCnpjEnrichmentJob, type CrmCnpjEnrichmentJobPayload } from '../jobs'

type RunResult = { status: string; processed: number } | { error: string }

/**
 * Runs one bulk CNPJ enrichment. Domain failures are written on the run row
 * and returned, never thrown: the queue has `attempts: 1`.
 */
export async function processCrmCnpjEnrichment(job: Job): Promise<RunResult> {
  switch (job.name) {
    case CrmCnpjEnrichmentJob.Run: {
      const { runId } =
        job.data as CrmCnpjEnrichmentJobPayload['run-enrichment']
      const result = await CrmCnpjEnrichmentRunner.run(runId)
      if (!result.ok) {
        logger.error('queue.crm_cnpj_enrichment.failed', {
          component: 'Worker',
          jobId: job.id,
          runId,
          code: result.error.code,
        })
        return { error: result.error.code }
      }
      logger.info('queue.crm_cnpj_enrichment.processed', {
        component: 'Worker',
        jobId: job.id,
        runId,
        processed: result.value.processed,
        enriched: result.value.enriched,
      })
      return { status: result.value.status, processed: result.value.processed }
    }
    default:
      throw new Error(
        `Unknown crm-cnpj-enrichment job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
