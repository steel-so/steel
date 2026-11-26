import type { Job } from 'bullmq'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { InboxAiPendingService } from '@/src/services/inbox-ai-pending.service'
import { NotificationWhatsappService } from '@/src/services/notification-whatsapp.service'
import { NotificationsJob, type NotificationsJobPayload } from '../jobs'

/**
 * Queue `notifications`: `ai-action-expiry-tick` (every minute) warns the
 * requester before a pending Steel AI action expires. Idempotent — the
 * notice carries a `dedupeKey`, so a retry never duplicates it.
 */
export async function processNotifications(job: Job): Promise<unknown> {
  switch (job.name) {
    case NotificationsJob.AiActionExpiryTick: {
      const result = await InboxAiPendingService.notifyExpiring()
      if (!result.ok) {
        throw new Error(
          `notifications expiry tick failed: ${result.error.code} ${result.error.message}`,
        )
      }
      logger.info(
        'queue.notifications.ai_action_expiry_completed',
        logFields(
          { component: 'Worker' },
          { jobId: job.id, sent: result.value },
        ),
      )
      return { sent: result.value }
    }
    case NotificationsJob.WhatsappDeliver: {
      const sent = await NotificationWhatsappService.deliver(
        job.data as NotificationsJobPayload[typeof NotificationsJob.WhatsappDeliver],
      )
      logger.info(
        'queue.notifications.whatsapp_delivered',
        logFields({ component: 'Worker' }, { jobId: job.id, ...sent }),
      )
      return sent
    }
    default:
      throw new Error(
        `Unknown notifications job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
