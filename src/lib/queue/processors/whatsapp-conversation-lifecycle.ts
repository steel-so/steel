import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppDistributionService } from '@/src/services/whatsapp-distribution.service'
import { WhatsAppUnassignedAlertService } from '@/src/services/whatsapp-unassigned-alert.service'
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

/**
 * Every minute (ADR 0047): hands the waiting conversations to the agents who
 * can take them now (a queue held by business hours, by absent or full
 * agents), then sends the "still unattended" reminders.
 */
async function processDistributionTick(
  job: Job,
): Promise<{ distributed: number; reminded: number }> {
  const now = new Date()
  const drained = await WhatsAppDistributionService.drainEnabledWorkspaces(now)
  if (!drained.ok) {
    throw new Error(
      `Falha ao distribuir a fila do WhatsApp: ${drained.error.code}`,
    )
  }
  const reminders = await WhatsAppUnassignedAlertService.remindUnattended(now)
  if (!reminders.ok) {
    throw new Error(
      `Falha ao lembrar conversas sem atendente: ${reminders.error.code}`,
    )
  }

  const result = {
    distributed: drained.value.assigned,
    reminded: reminders.value.reminded,
  }
  if (result.distributed > 0 || result.reminded > 0) {
    logger.info('queue.whatsapp_conversation_lifecycle.distribution_tick', {
      component: 'WhatsappConversationLifecycle',
      jobId: job.id,
      ...result,
    })
  }
  return result
}

export async function processWhatsappConversationLifecycle(
  job: Job,
): Promise<{ closed: number } | { distributed: number; reminded: number }> {
  switch (job.name) {
    case WhatsappConversationLifecycleJob.AutoCloseInactive:
      return processAutoCloseInactive(job)
    case WhatsappConversationLifecycleJob.DistributionTick:
      return processDistributionTick(job)
    default:
      throw new Error(
        `Unknown whatsapp-conversation-lifecycle job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
