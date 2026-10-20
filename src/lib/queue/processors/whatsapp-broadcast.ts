import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppAutoOutreachService } from '@/src/services/whatsapp-auto-outreach.service'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsappBroadcastJob, type WhatsappBroadcastJobPayload } from '../jobs'

async function processSendBroadcastMessage(
  job: Job<WhatsappBroadcastJobPayload['send-broadcast-message']>,
): Promise<void> {
  const { broadcastListId, recipientId } = job.data
  const base = { component: 'WhatsappBroadcast', jobId: job.id, recipientId }

  const result = await WhatsAppBroadcastService.sendToRecipient(
    broadcastListId,
    recipientId,
  )
  if (!result.ok) {
    throw new Error(
      `Falha ao processar destinatário da transmissão: ${result.error.code}`,
    )
  }

  const outcome = result.value
  if (outcome.status === 'skipped') {
    if (outcome.reason === 'recipient_missing') {
      logger.warn('queue.whatsapp_broadcast.recipient_missing', base)
    } else if (outcome.reason === 'opted_out') {
      logger.info('queue.whatsapp_broadcast.skipped_opted_out', base)
    }
    return
  }

  logger.info('queue.whatsapp_broadcast.processed', {
    ...base,
    ok: outcome.status === 'sent',
  })
}

async function processRunScheduleTick(job: Job): Promise<void> {
  const result = await WhatsAppBroadcastService.enqueueDueScheduledRecipients(
    new Date(),
  )
  if (!result.ok) {
    throw new Error(
      `Failed to list due scheduled broadcast recipients: ${result.error.code}`,
    )
  }

  logger.info('queue.whatsapp_broadcast.tick_completed', {
    component: 'WhatsappBroadcast',
    jobId: job.id,
    due: result.value.due,
  })
}

async function processSendAutoOutreachNext(
  job: Job<WhatsappBroadcastJobPayload['send-auto-outreach-next']>,
): Promise<void> {
  const { workspaceId, runToken } = job.data
  const result = await WhatsAppAutoOutreachService.sendNext(
    workspaceId,
    runToken,
  )
  // Database failure: throw so BullMQ retries the step (nothing was sent).
  if (!result.ok) {
    throw new Error(
      `Failed to run the auto outreach step: ${result.error.code}`,
    )
  }

  const outcome = result.value
  const base = { component: 'WhatsappAutoOutreach', jobId: job.id, workspaceId }
  if (outcome.status === 'paused') {
    logger.warn('queue.whatsapp_auto_outreach.paused', {
      ...base,
      reason: outcome.reason,
    })
    return
  }
  logger.info('queue.whatsapp_auto_outreach.step', {
    ...base,
    outcome: outcome.status,
  })
}

export async function processWhatsappBroadcast(job: Job): Promise<void> {
  switch (job.name) {
    case WhatsappBroadcastJob.SendBroadcastMessage:
      return processSendBroadcastMessage(
        job as Job<WhatsappBroadcastJobPayload['send-broadcast-message']>,
      )
    case WhatsappBroadcastJob.RunScheduleTick:
      return processRunScheduleTick(job)
    case WhatsappBroadcastJob.SendAutoOutreachNext:
      return processSendAutoOutreachNext(
        job as Job<WhatsappBroadcastJobPayload['send-auto-outreach-next']>,
      )
    default:
      throw new Error(
        `Unknown whatsapp-broadcast job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
