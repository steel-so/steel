import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { SitePostScheduleService } from '@/src/services/site-post-schedule.service'
import { SitePostsJob } from '../jobs'

/** Site blog: publishes the scheduled posts that are due (every minute). */
export async function processSitePosts(
  job: Job,
): Promise<{ published: number; sites: number }> {
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
    default:
      throw new Error(
        `Unknown site-posts job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
