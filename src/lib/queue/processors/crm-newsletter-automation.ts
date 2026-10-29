import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'
import { CrmNewsletterWelcomeSendService } from '@/src/services/crm-newsletter-welcome-send.service'
import { CrmNewsletterAutomationJob } from '../jobs'

/**
 * `crm-newsletter-automation` queue (newsletter2, nl2-automation): welcome
 * series tick, monthly re-engagement run and the daily end of the grace
 * periods. The inner function takes the clock so tests drive time.
 */
export async function runCrmNewsletterAutomationJob(
  job: Job,
  now: Date,
): Promise<unknown> {
  const base = { component: 'CrmNewsletterAutomation', jobId: job.id }

  switch (job.name) {
    case CrmNewsletterAutomationJob.WelcomeTick: {
      const result = await CrmNewsletterWelcomeSendService.tick(now)
      if (!result.ok) {
        throw new Error(`Newsletter welcome tick failed: ${result.error.code}`)
      }
      logger.info('queue.crm_newsletter_automation.welcome_tick', {
        ...base,
        ...result.value,
      })
      return result.value
    }
    case CrmNewsletterAutomationJob.ReengagementMonthly: {
      const result = await CrmNewsletterReengagementService.runMonthly(now)
      if (!result.ok) {
        throw new Error(
          `Newsletter re-engagement run failed: ${result.error.code}`,
        )
      }
      logger.info('queue.crm_newsletter_automation.reengagement_monthly', {
        ...base,
        ...result.value,
      })
      return result.value
    }
    case CrmNewsletterAutomationJob.ReengagementResolve: {
      const result = await CrmNewsletterReengagementService.resolveDue(now)
      if (!result.ok) {
        throw new Error(
          `Newsletter re-engagement resolve failed: ${result.error.code}`,
        )
      }
      logger.info('queue.crm_newsletter_automation.reengagement_resolve', {
        ...base,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown crm-newsletter-automation job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}

export function processCrmNewsletterAutomation(job: Job): Promise<unknown> {
  return runCrmNewsletterAutomationJob(job, new Date())
}
