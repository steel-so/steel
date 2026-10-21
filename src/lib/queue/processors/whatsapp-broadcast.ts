import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppAiCampaignService } from '@/src/services/whatsapp-ai-campaign.service'
import { WhatsAppAiCampaignActionService } from '@/src/services/whatsapp-ai-campaign-action.service'
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

async function processSendAiCampaignNext(
  job: Job<WhatsappBroadcastJobPayload['send-ai-campaign-next']>,
): Promise<void> {
  const { campaignId, runToken } = job.data
  const result = await WhatsAppAiCampaignService.sendNext(campaignId, runToken)
  // Database failure: throw so BullMQ retries the step (nothing was sent).
  if (!result.ok) {
    throw new Error(`Failed to run the AI campaign step: ${result.error.code}`)
  }

  const outcome = result.value
  const base = { component: 'WhatsappAiCampaign', jobId: job.id, campaignId }
  if (outcome.status === 'paused') {
    logger.warn('queue.whatsapp_ai_campaign.paused', {
      ...base,
      reason: outcome.reason,
    })
    return
  }
  logger.info('queue.whatsapp_ai_campaign.step', {
    ...base,
    outcome: outcome.status,
  })
}

async function processAiCampaignFollowUp(
  job: Job<WhatsappBroadcastJobPayload['ai-campaign-follow-up']>,
): Promise<void> {
  const result = await WhatsAppAiCampaignActionService.followUp(job.data)
  if (!result.ok) {
    throw new Error(
      `Failed to run the AI campaign follow-up: ${result.error.code}`,
    )
  }
  logger.info('queue.whatsapp_ai_campaign.follow_up', {
    component: 'WhatsappAiCampaign',
    jobId: job.id,
    campaignId: job.data.campaignId,
    conversationId: job.data.conversationId,
    outcome: result.value.status,
    reason: result.value.reason,
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
    case WhatsappBroadcastJob.SendAiCampaignNext:
      return processSendAiCampaignNext(
        job as Job<WhatsappBroadcastJobPayload['send-ai-campaign-next']>,
      )
    case WhatsappBroadcastJob.AiCampaignFollowUp:
      return processAiCampaignFollowUp(
        job as Job<WhatsappBroadcastJobPayload['ai-campaign-follow-up']>,
      )
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
