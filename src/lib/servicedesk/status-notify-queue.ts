import { logger } from '@/lib/axiom/logger'
import { ServicedeskMailJob } from '@/src/lib/queue/jobs'
import { getServicedeskMailQueue } from '@/src/lib/queue/queues'

/**
 * Enqueues the e-mail/WhatsApp notices of a published major-incident update
 * (queue `servicedesk-mail`). Never throws: the update is already saved, and
 * a lost job only means the subscribers were not warned (logged).
 */
export async function enqueueSdStatusUpdateNotice(
  updateId: string,
): Promise<void> {
  try {
    await getServicedeskMailQueue().add(
      ServicedeskMailJob.NotifyStatusUpdate,
      { updateId },
      { jobId: `status-update-${updateId}` },
    )
  } catch (error) {
    logger.error('servicedesk.status.enqueue_failed', {
      job: ServicedeskMailJob.NotifyStatusUpdate,
      updateId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Enqueues the e-mail/WhatsApp notice of a maintenance window (queue
 * `servicedesk-mail`). A rescheduled window gets a fresh job id so BullMQ does
 * not drop it as a duplicate of the first announcement. Never throws.
 */
export async function enqueueSdMaintenanceNotice(
  maintenanceId: string,
  kind: 'scheduled' | 'rescheduled' | 'canceled',
): Promise<void> {
  try {
    await getServicedeskMailQueue().add(
      ServicedeskMailJob.NotifyMaintenance,
      { maintenanceId, kind },
      {
        jobId:
          kind === 'rescheduled'
            ? `maintenance-${kind}-${maintenanceId}-${Date.now()}`
            : `maintenance-${kind}-${maintenanceId}`,
      },
    )
  } catch (error) {
    logger.error('servicedesk.status.enqueue_failed', {
      job: ServicedeskMailJob.NotifyMaintenance,
      maintenanceId,
      kind,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
