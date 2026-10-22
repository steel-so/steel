import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppSlaEngineService } from '@/src/services/whatsapp-sla-engine.service'
import { WhatsappConversationLifecycleJob } from '../jobs'

async function processAutoCloseInactive(job: Job): Promise<{ closed: number }> {
  const result = await WhatsAppConversationService.closeInactive(new Date())
  if (!result.ok) {
    throw new Error(
      `Falha ao fechar conversas inativas do WhatsApp: ${result.error.code}`,
    )
  }

  logger.info('queue.whatsapp_conversation_lifecycle.auto_close_completed', {
    component: 'WhatsappConversationLifecycle',
    jobId: job.id,
    closed: result.value.closed,
  })
  return result.value
}

async function processSlaTick(
  job: Job,
): Promise<{ warned: number; breached: number }> {
  const result = await WhatsAppSlaEngineService.scanDue(new Date())
  if (!result.ok) {
    throw new Error(`Falha ao varrer o SLA do WhatsApp: ${result.error.code}`)
  }

  if (result.value.warned > 0 || result.value.breached > 0) {
    logger.info('queue.whatsapp_conversation_lifecycle.sla_tick_completed', {
      component: 'WhatsappConversationLifecycle',
      jobId: job.id,
      ...result.value,
    })
  }
  return result.value
}

export async function processWhatsappConversationLifecycle(
  job: Job,
): Promise<{ closed: number } | { warned: number; breached: number }> {
  switch (job.name) {
    case WhatsappConversationLifecycleJob.AutoCloseInactive:
      return processAutoCloseInactive(job)
    case WhatsappConversationLifecycleJob.SlaTick:
      return processSlaTick(job)
    default:
      throw new Error(
        `Unknown whatsapp-conversation-lifecycle job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
