import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { SitePostScheduleService } from '@/src/services/site-post-schedule.service'
import { SiteSeoService } from '@/src/services/site-seo.service'
import { SitePostsJob } from '../jobs'

/**
 * Site jobs: publishes the scheduled blog posts that are due (every minute)
 * and records the daily SEO snapshot of every site (CRM > SEO).
 */
export async function processSitePosts(
  job: Job,
): Promise<
  | { published: number; sites: number }
  | { sites: number; failed: number; pruned: number }
> {
  switch (job.name) {
    case SitePostsJob.PublishDue: {
      const result = await SitePostScheduleService.publishDue(new Date())
      if (!result.ok) {
        // Read/write failure: throw so BullMQ retries the tick.
        throw new Error(
          `Failed to publish due site posts: ${result.error.code} (${result.error.message})`,
        )
      }
      if (result.value.published > 0) {
        logger.info('queue.site_posts.published', {
          component: 'Worker',
          jobId: job.id,
          ...result.value,
        })
      }
      return result.value
    }
    case SitePostsJob.SeoSnapshot: {
      const result = await SiteSeoService.recordDailySnapshots(new Date())
      if (!result.ok) {
        throw new Error(
          `Failed to record site SEO snapshots: ${result.error.code} (${result.error.message})`,
        )
      }
      logger.info('queue.site_seo.snapshot', {
        component: 'Worker',
        jobId: job.id,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown site-posts job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
