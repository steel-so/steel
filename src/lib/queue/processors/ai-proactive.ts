import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  AiDigestService,
  type AiDigestTickResult,
} from '@/src/services/ai-digest.service'
import {
  AiInsightGeneratorService,
  type AiInsightTickResult,
} from '@/src/services/ai-insight-generator.service'
import { AiProactiveJob } from '../jobs'

/**
 * `ai-proactive` queue (ADR 0040): the insights tick (every 15 min) and the
 * daily digest tick (hourly). Neither service throws; the queue has a
 * single attempt because the next tick redoes the work anyway.
 */
export async function processAiProactive(
  job: Job,
): Promise<AiInsightTickResult | AiDigestTickResult> {
  switch (job.name) {
    case AiProactiveJob.InsightsTick: {
      const result = await AiInsightGeneratorService.runTick()
      logger.info('queue.ai_proactive.insights_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result,
      })
      return result
    }
    case AiProactiveJob.DigestTick: {
      const result = await AiDigestService.runTick()
      logger.info('queue.ai_proactive.digest_completed', {
        component: 'Worker',
        jobId: job.id,
        ...result,
      })
      return result
    }
    default:
      throw new Error(
        `Unknown ai-proactive job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
