import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppChatbotRuntimeService } from '@/src/services/whatsapp-chatbot-runtime.service'
import { WhatsappChatbotJob, type WhatsappChatbotJobPayload } from '../jobs'

async function processRunStep(
  job: Job<WhatsappChatbotJobPayload['run-chatbot-step']>,
): Promise<void> {
  const { sessionId, messageId } = job.data
  const base = { component: 'WhatsappChatbot', jobId: job.id, sessionId }

  const result = await WhatsAppChatbotRuntimeService.runStep({
    sessionId,
    messageId,
  })
  // Database failure before anything was sent: let BullMQ retry.
  if (!result.ok) {
    throw new Error(`Falha ao rodar o chatbot: ${result.error.code}`)
  }

  const outcome = result.value
  if (outcome.status === 'skipped') {
    logger.info('queue.whatsapp_chatbot.skipped', {
      ...base,
      reason: outcome.reason,
    })
    return
  }
  logger.info('queue.whatsapp_chatbot.ran', {
    ...base,
    sessionStatus: outcome.sessionStatus,
    sent: outcome.sent,
  })
}

export async function processWhatsappChatbot(job: Job): Promise<void> {
  switch (job.name) {
    case WhatsappChatbotJob.RunStep:
      return processRunStep(
        job as Job<WhatsappChatbotJobPayload['run-chatbot-step']>,
      )
    default:
      throw new Error(
        `Unknown whatsapp-chatbot job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
