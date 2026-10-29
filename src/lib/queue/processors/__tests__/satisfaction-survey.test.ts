import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { SatisfactionSurveyService } from '@/src/services/satisfaction-survey.service'
import { processSatisfactionSurvey } from '../satisfaction-survey'

vi.mock('@/src/services/satisfaction-survey.service', () => ({
  SatisfactionSurveyService: { deliver: vi.fn() },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const job = (name: string) =>
  ({ id: 'j1', name, data: { surveyId: 's1' } }) as unknown as Job

beforeEach(() => vi.resetAllMocks())

describe('processSatisfactionSurvey', () => {
  it('delivers the survey', async () => {
    vi.mocked(SatisfactionSurveyService.deliver).mockResolvedValue(ok('sent'))
    await processSatisfactionSurvey(job('deliver-survey'))
    expect(SatisfactionSurveyService.deliver).toHaveBeenCalledWith('s1')
  })

  it('throws on a database failure so BullMQ retries', async () => {
    vi.mocked(SatisfactionSurveyService.deliver).mockResolvedValue(
      err(databaseError('x')),
    )
    await expect(
      processSatisfactionSurvey(job('deliver-survey')),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('rejects unknown jobs', async () => {
    await expect(processSatisfactionSurvey(job('nope'))).rejects.toThrow(
      'Unknown satisfaction-survey job',
    )
  })
})
