import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppSpendCapService } from '@/src/services/whatsapp-spend-cap.service'
import { WhatsappMetaSpendJob } from '../jobs'

/**
 * `whatsapp-meta-spend` queue (ADR 0064): the 15-minute refresh of Meta's
 * spend for every number with a monthly cap. The service never throws; a
 * single attempt is enough because the next tick redoes it.
 */
export async function processWhatsappMetaSpend(
  job: Job,
): Promise<{ connections: number; refreshed: number; failed: number }> {
  switch (job.name) {
    case WhatsappMetaSpendJob.RefreshTick: {
      const result = await WhatsAppSpendCapService.refreshTick()
      logger.info('queue.whatsapp_meta_spend.tick_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result,
      })
      return result
    }
    default:
      throw new Error(
        `Unknown whatsapp-meta-spend job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
