import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { CrmNewsletterSendService } from '@/src/services/crm-newsletter-send.service'
import { CrmNewsletterWhatsAppService } from '@/src/services/crm-newsletter-whatsapp.service'
import { CrmNewsletterJob, type CrmNewsletterJobPayload } from '../jobs'

/**
 * `crm-newsletter` queue (ADR 0054). The exported processor takes only the
 * job; the inner function takes the clock so tests drive time explicitly.
 */
export async function runCrmNewsletterJob(
  job: Job,
  now: Date,
): Promise<unknown> {
  const base = { component: 'CrmNewsletter', jobId: job.id }

  switch (job.name) {
    case CrmNewsletterJob.Tick: {
      const result = await CrmNewsletterSendService.tick(now)
      if (!result.ok) {
        throw new Error(`CRM newsletter tick failed: ${result.error.code}`)
      }
      logger.info('queue.crm_newsletter.tick_completed', {
        ...base,
        ...result.value,
      })
      return result.value
    }
    case CrmNewsletterJob.Dispatch: {
      const data = job.data as CrmNewsletterJobPayload['dispatch']
      const result = await CrmNewsletterSendService.dispatch(data.issueId, now)
      if (!result.ok) {
        throw new Error(
          `Failed to dispatch CRM newsletter issue: ${result.error.code}`,
        )
      }
      // Transient provider failure: rows went back to PENDING — let BullMQ
      // retry (the minute tick picks them up anyway).
      if (result.value.status === 'retry') {
        throw new Error(
          `CRM newsletter dispatch deferred: ${result.value.reason}`,
        )
      }
      logger.info('queue.crm_newsletter.dispatched', {
        ...base,
        issueId: data.issueId,
        ...result.value,
      })
      return result.value
    }
    case CrmNewsletterJob.WhatsAppDispatch: {
      const data = job.data as CrmNewsletterJobPayload['whatsapp-dispatch']
      const result = await CrmNewsletterWhatsAppService.dispatch(
        data.issueId,
        now,
      )
      if (!result.ok) {
        throw new Error(
          `Failed to dispatch CRM newsletter WhatsApp: ${result.error.code}`,
        )
      }
      logger.info('queue.crm_newsletter.whatsapp_dispatched', {
        ...base,
        issueId: data.issueId,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-newsletter job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}

export function processCrmNewsletter(job: Job): Promise<unknown> {
  return runCrmNewsletterJob(job, new Date())
}
