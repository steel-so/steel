import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  SendingDomainService,
  type SendingDomainTickResult,
} from '@/src/services/sending-domain.service'
import { SendingDomainsJob } from '../jobs'

/**
 * `sending-domains` queue (ADR 0054): the 10-minute re-check tick. The
 * service never throws; a single attempt is enough because the next tick
 * picks up whatever is still due.
 */
export async function processSendingDomains(
  job: Job,
): Promise<SendingDomainTickResult> {
  switch (job.name) {
    case SendingDomainsJob.CheckTick: {
      const result = await SendingDomainService.runCheckTick()
      logger.info('queue.sending_domains.tick_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result,
      })
      return result
    }
    default:
      throw new Error(
        `Unknown sending-domains job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
