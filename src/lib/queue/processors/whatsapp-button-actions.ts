import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppButtonActionService } from '@/src/services/whatsapp-button-action.service'
import {
  WhatsappButtonActionsJob,
  type WhatsappButtonActionsJobPayload,
} from '../jobs'

type RunJob = Job<WhatsappButtonActionsJobPayload['run-button-actions']>

async function processRunButtonActions(job: RunJob): Promise<void> {
  const base = {
    component: 'WhatsappButtonActions',
    jobId: job.id,
    workspaceId: job.data.workspaceId,
    conversationId: job.data.conversationId,
    buttonId: job.data.buttonId,
  }
  const result = await WhatsAppButtonActionService.runActions(job.data)
  // Database failure loading the click context: let BullMQ retry.
  if (!result.ok) {
    throw new Error(`Falha ao executar ações do botão: ${result.error.code}`)
  }

  const outcome = result.value
  if (outcome.status === 'skipped') {
    logger.info('queue.whatsapp_button_actions.skipped', {
      ...base,
      reason: outcome.reason,
    })
    return
  }
  const failed = outcome.results.filter((r) => !r.ok).length
  logger.info('queue.whatsapp_button_actions.ran', {
    ...base,
    actions: outcome.results.length,
    failed,
  })
}

export async function processWhatsappButtonActions(job: Job): Promise<void> {
  switch (job.name) {
    case WhatsappButtonActionsJob.RunButtonActions:
      return processRunButtonActions(job as RunJob)
    default:
      throw new Error(
        `Unknown whatsapp-button-actions job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
