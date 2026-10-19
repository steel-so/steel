import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { PhoneCallAiService } from '@/src/services/phone-call-ai.service'
import { PhoneCallAiJob, type PhoneCallAiJobPayload } from '../jobs'

/** Missing resources (quota, provider) are worth a warning; the rest is info. */
const WARN_SKIP_REASONS = new Set([
  'ai_quota_exceeded',
  'ai_provider_unavailable',
  'no_transcription_provider',
])

async function processRecording(
  job: Job<PhoneCallAiJobPayload['process-recording']>,
): Promise<void> {
  const { callId } = job.data
  const base = { component: 'PhoneCallAi', jobId: job.id, callId }

  const result = await PhoneCallAiService.process(callId)
  // Database failure: throw so BullMQ retries.
  if (!result.ok) {
    throw new Error(`Failed to process call recording: ${result.error.code}`)
  }

  const outcome = result.value
  switch (outcome.status) {
    case 'ignored':
      logger.info('queue.phone_call_ai.ignored', {
        ...base,
        reason: outcome.reason,
      })
      return
    case 'skipped':
      if (WARN_SKIP_REASONS.has(outcome.reason)) {
        logger.warn('queue.phone_call_ai.skipped', {
          ...base,
          reason: outcome.reason,
        })
      } else {
        logger.info('queue.phone_call_ai.skipped', {
          ...base,
          reason: outcome.reason,
        })
      }
      return
    case 'failed':
      logger.error('queue.phone_call_ai.failed', {
        ...base,
        reason: outcome.reason,
        message: outcome.detail,
      })
      return
    case 'done':
      logger.info('queue.phone_call_ai.done', {
        ...base,
        workspaceId: outcome.workspaceId,
        summarized: outcome.summarized,
        ...outcome.links,
      })
      return
  }
}

export async function processPhoneCallAi(job: Job): Promise<void> {
  switch (job.name) {
    case PhoneCallAiJob.ProcessRecording:
      return processRecording(
        job as Job<PhoneCallAiJobPayload['process-recording']>,
      )
    default:
      throw new Error(
        `Unknown phone-call-ai job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
