import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { CrmContractService } from '@/src/services/crm-contract.service'
import type { CrmRenewalScanResultDTO } from '@/types/crm-deals'
import { CrmDealsJob } from '../jobs'

/**
 * Queue `crm-deals` (nov: crm-deals, C9): `renewal-scan` runs daily and, for
 * every CRM workspace, warns the owner of the contracts that entered the
 * renewal window, opens their renewal deal, rolls the auto-renewing ones
 * forward and expires the ended ones.
 *
 * Idempotent: each contract is alerted once (`alertedAt`) and gets one renewal
 * deal (`renewalOpportunityId`), so a retry never duplicates either.
 */
export async function processCrmDeals(
  job: Job<{ workspaceId?: string }>,
): Promise<CrmRenewalScanResultDTO> {
  switch (job.name) {
    case CrmDealsJob.RenewalScan: {
      const result = await CrmContractService.renewalTick({
        workspaceId: job.data?.workspaceId,
      })
      if (!result.ok) {
        throw new Error(
          `crm-deals renewal scan failed: ${result.error.code} ${result.error.message}`,
        )
      }
      logger.info('queue.crm_deals.renewal_scan_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-deals job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
