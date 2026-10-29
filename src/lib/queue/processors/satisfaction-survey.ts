import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { SatisfactionSurveyService } from '@/src/services/satisfaction-survey.service'
import {
  SatisfactionSurveyJob,
  type SatisfactionSurveyJobPayload,
} from '../jobs'

type DeliverJob = Job<SatisfactionSurveyJobPayload['deliver-survey']>

async function processDeliverSurvey(job: DeliverJob): Promise<void> {
  const result = await SatisfactionSurveyService.deliver(job.data.surveyId)
  // Database failure: let BullMQ retry. Provider failures are recorded on the
  // survey itself (FAILED / e-mail fallback) and do not retry the job.
  if (!result.ok) {
    throw new Error(
      `Falha ao enviar a pesquisa de satisfação: ${result.error.code}`,
    )
  }
  logger.info('queue.satisfaction_survey.delivered', {
    component: 'SatisfactionSurvey',
    jobId: job.id,
    surveyId: job.data.surveyId,
    outcome: result.value,
  })
}

export async function processSatisfactionSurvey(job: Job): Promise<void> {
  switch (job.name) {
    case SatisfactionSurveyJob.DeliverSurvey:
      return processDeliverSurvey(job as DeliverJob)
    default:
      throw new Error(
        `Unknown satisfaction-survey job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
