import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { QaReviewService } from '@/src/services/qa-review.service'
import { QaReviewJob, type QaReviewJobPayload } from '../jobs'

type ReviewJob = Job<QaReviewJobPayload['review']>

async function processReview(job: ReviewJob): Promise<void> {
  const { reviewId } = job.data
  const result = await QaReviewService.run(reviewId)
  // Database failure: let BullMQ retry. Provider and quota problems are
  // recorded on the review itself (FAILED / SKIPPED) and do not retry.
  if (!result.ok) {
    throw new Error(`Falha ao avaliar o atendimento: ${result.error.code}`)
  }
  const level = result.value.status === 'completed' ? 'info' : 'warn'
  logger[level]('queue.qa_review.processed', {
    component: 'QaReview',
    jobId: job.id,
    reviewId,
    ...result.value,
  })
}

export async function processQaReview(job: Job): Promise<void> {
  switch (job.name) {
    case QaReviewJob.Review:
      return processReview(job as ReviewJob)
    default:
      throw new Error(
        `Unknown qa-review job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
