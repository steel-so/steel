import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
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

export async function processWhatsappBroadcast(job: Job): Promise<void> {
  switch (job.name) {
    case WhatsappBroadcastJob.SendBroadcastMessage:
      return processSendBroadcastMessage(
        job as Job<WhatsappBroadcastJobPayload['send-broadcast-message']>,
      )
    case WhatsappBroadcastJob.RunScheduleTick:
      return processRunScheduleTick(job)
    case WhatsappBroadcastJob.SendAutoOutreachNext:
      // Chains of the removed auto outreach still queued at deploy time:
      // the outreach became a paused AI campaign, nothing to send.
      logger.info('queue.whatsapp_broadcast.legacy_auto_outreach_dropped', {
        component: 'WhatsappBroadcast',
        jobId: job.id,
      })
      return
    default:
      throw new Error(
        `Unknown whatsapp-broadcast job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
