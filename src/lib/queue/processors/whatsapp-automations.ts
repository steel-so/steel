import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  type SchedulingTickResult,
  WhatsAppSchedulingService,
} from '@/src/services/whatsapp-scheduling.service'
import {
  type EcomTickResult,
  WhatsAppStoreService,
} from '@/src/services/whatsapp-store.service'
import { WhatsappAutomationsJob } from '../jobs'

export async function processWhatsappAutomations(
  job: Job,
): Promise<EcomTickResult | SchedulingTickResult> {
  switch (job.name) {
    case WhatsappAutomationsJob.EcomTick: {
      const result = await WhatsAppStoreService.tick()
      if (!result.ok) {
        // Claim failed: throw so BullMQ retries; nothing was sent.
        throw new Error(
          `Failed to run store triggers: ${result.error.code} (${result.error.message})`,
        )
      }
      if (result.value.claimed > 0) {
        logger.info('queue.whatsapp_automations.ecom_tick_completed', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    case WhatsappAutomationsJob.SchedulingTick: {
      const result = await WhatsAppSchedulingService.tick()
      if (!result.ok) {
        throw new Error(
          `Failed to run appointment messages: ${result.error.code} (${result.error.message})`,
        )
      }
      if (
        result.value.confirmations +
          result.value.reminders +
          result.value.failed >
        0
      ) {
        logger.info('queue.whatsapp_automations.scheduling_tick_completed', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    default:
      throw new Error(
        `Unknown whatsapp-automations job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
