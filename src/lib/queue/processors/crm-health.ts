import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  CrmHealthService,
  type CrmHealthTickResult,
} from '@/src/services/crm-health.service'
import { CrmHealthJob } from '../jobs'

/**
 * Queue `crm-health` (nov-health-scores): `recompute-health` runs hourly and
 * rescores the open deals (C4) and the companies (T4) of every CRM workspace,
 * alerting the owner of the records that enter the high-risk band.
 *
 * Idempotent: one row per record (upsert), and an alert fires only when the
 * stored previous level was not already high, so a retry never re-warns.
 */
export async function processCrmHealth(
  job: Job<{ workspaceId?: string }>,
): Promise<CrmHealthTickResult> {
  switch (job.name) {
    case CrmHealthJob.Recompute: {
      const result = await CrmHealthService.recomputeTick({
        workspaceId: job.data?.workspaceId,
      })
      if (!result.ok) {
        throw new Error(
          `crm-health recompute failed: ${result.error.code} ${result.error.message}`,
        )
      }
      logger.info('queue.crm_health.recompute_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-health job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
