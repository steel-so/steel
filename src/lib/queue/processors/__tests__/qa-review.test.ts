import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/lib/axiom/logger'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { QaReviewService } from '@/src/services/qa-review.service'
import { processQaReview } from '../qa-review'

vi.mock('@/src/services/qa-review.service', () => ({
  QaReviewService: { run: vi.fn() },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const job = (name: string) =>
  ({ id: 'j1', name, data: { reviewId: 'r1' } }) as unknown as Job

beforeEach(() => vi.resetAllMocks())

describe('processQaReview', () => {
  it('runs the review and logs a completed one as info', async () => {
    vi.mocked(QaReviewService.run).mockResolvedValue(
      ok({ status: 'completed', score: 80, lowScore: false }),
    )
    await processQaReview(job('review'))
    expect(QaReviewService.run).toHaveBeenCalledWith('r1')
    expect(logger.info).toHaveBeenCalledWith(
      'queue.qa_review.processed',
      expect.objectContaining({ reviewId: 'r1', score: 80 }),
    )
  })

  it('logs a skipped review as a warning without retrying', async () => {
    vi.mocked(QaReviewService.run).mockResolvedValue(
      ok({ status: 'skipped', reason: 'ai_quota_exceeded' }),
    )
    await processQaReview(job('review'))
    expect(logger.warn).toHaveBeenCalledWith(
      'queue.qa_review.processed',
      expect.objectContaining({ reason: 'ai_quota_exceeded' }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    vi.mocked(QaReviewService.run).mockResolvedValue(err(databaseError('x')))
    await expect(processQaReview(job('review'))).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('rejects unknown jobs', async () => {
    await expect(processQaReview(job('nope'))).rejects.toThrow(
      'Unknown qa-review job',
    )
  })
})
