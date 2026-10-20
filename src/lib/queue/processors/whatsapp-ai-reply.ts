import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppAiReplyService } from '@/src/services/whatsapp-ai-reply.service'
import { WhatsappAiReplyJob, type WhatsappAiReplyJobPayload } from '../jobs'
import { getWhatsappAiReplyQueue } from '../queues'

// Motivos de "pulei" que indicam falta de recurso (cota/provedor) — sobem
// como warn para aparecerem nos alertas; o resto é fluxo normal (info).
const WARN_SKIP_REASONS = new Set([
  'ai_quota_exceeded',
  'ai_provider_unavailable',
  'ai_prepare_failed',
])

async function processGenerateAiReply(
  job: Job<WhatsappAiReplyJobPayload['generate-ai-reply']>,
): Promise<void> {
  const { conversationId, messageId } = job.data
  const base = { component: 'WhatsappAiReply', jobId: job.id, conversationId }

  const result = await WhatsAppAiReplyService.generateReply({
    conversationId,
    messageId,
  })
  // Falha de banco: lança para o BullMQ tentar de novo (backoff padrão).
  if (!result.ok) {
    throw new Error(`Falha ao gerar resposta da IA: ${result.error.code}`)
  }

  const outcome = result.value
  switch (outcome.status) {
    case 'deferred': {
      // One deferred answer per conversation and opening: the reply reads
      // the latest history anyway, so later messages ride the same job.
      const delay = Math.max(0, outcome.retryAt.getTime() - Date.now())
      await getWhatsappAiReplyQueue().add(
        WhatsappAiReplyJob.GenerateAiReply,
        job.data,
        {
          delay,
          jobId: `ai-reply-deferred-${conversationId}-${outcome.retryAt.getTime()}`,
        },
      )
      logger.info('queue.whatsapp_ai_reply.deferred', {
        ...base,
        retryAt: outcome.retryAt.toISOString(),
      })
      return
    }
    case 'skipped':
      if (outcome.reason === 'empty_completion') {
        logger.warn('queue.whatsapp_ai_reply.empty_completion', base)
      } else if (WARN_SKIP_REASONS.has(outcome.reason)) {
        logger.warn('queue.whatsapp_ai_reply.skipped', {
          ...base,
          reason: outcome.reason,
        })
      } else {
        logger.info('queue.whatsapp_ai_reply.skipped', {
          ...base,
          reason: outcome.reason,
        })
      }
      return
    case 'failed':
      if (outcome.reason === 'provider_failed') {
        logger.error('queue.whatsapp_ai_reply.provider_failed', {
          ...base,
          provider: outcome.provider,
          model: outcome.model,
          message: outcome.detail,
        })
      } else {
        logger.error('queue.whatsapp_ai_reply.send_failed', {
          ...base,
          reason: outcome.detail,
        })
      }
      return
    case 'sent':
      if (outcome.handoff) {
        logger.info('queue.whatsapp_ai_reply.handoff', base)
      }
      logger.info('queue.whatsapp_ai_reply.sent', base)
      return
  }
}

export async function processWhatsappAiReply(job: Job): Promise<void> {
  switch (job.name) {
    case WhatsappAiReplyJob.GenerateAiReply:
      return processGenerateAiReply(
        job as Job<WhatsappAiReplyJobPayload['generate-ai-reply']>,
      )
    default:
      throw new Error(
        `Unknown whatsapp-ai-reply job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
