import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { sendSdStatusUpdateEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { ok, type Result } from '@/src/lib/result'
import {
  SD_MAJOR_INCIDENT_IMPACT_LABEL,
  SD_MAJOR_INCIDENT_STATUS_LABEL,
  SD_STATUS_NOTIFY_MAX_SUBSCRIBERS,
  SD_STATUS_WHATSAPP_GAP_MS,
  sdStatusPagePath,
  sdStatusSubscriptionPath,
  sdStatusUpdateText,
} from '@/src/lib/servicedesk/major-incident'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { activeWhatsappConnection } from './sd-notification.service'

export interface SdStatusNotifyResult {
  /** The update was not published, was already sent or has no audience. */
  skipped: 'not_found' | 'not_published' | 'already_sent' | null
  total: number
  sent: number
  failed: number
}

const NONE = (
  skipped: SdStatusNotifyResult['skipped'],
): SdStatusNotifyResult => ({
  skipped,
  total: 0,
  sent: 0,
  failed: 0,
})

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Delivers one published major-incident update to the confirmed subscribers
 * of the incident's status pages: e-mail through Resend and WhatsApp through
 * the workspace's ServiceDesk connection. Idempotent — the update is claimed
 * (`notifiedAt`) before anything is sent, so a retry never repeats a notice.
 * A failure for one subscriber never stops the others.
 */
export const SdStatusNotifyService = {
  async deliver(updateId: string): Promise<Result<SdStatusNotifyResult>> {
    const found = await SdMajorIncidentRepository.findUpdate(updateId)
    if (!found.ok) return found
    if (!found.value) return ok(NONE('not_found'))
    const { update, incident } = found.value
    if (!update.publish) return ok(NONE('not_published'))

    const claimed = await SdMajorIncidentRepository.claimNotification(updateId)
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok(NONE('already_sent'))

    const pages = await SdStatusPageRepository.findManyByIds(
      incident.workspaceId,
      incident.pageIds,
    )
    if (!pages.ok) return pages
    const published = pages.value.filter((page) => page.published)
    const subscribers = await SdStatusPageRepository.listConfirmedForPages(
      published.map((page) => page.id),
      SD_STATUS_NOTIFY_MAX_SUBSCRIBERS,
    )
    if (!subscribers.ok) return subscribers
    const audience = subscribers.value.slice(
      0,
      SD_STATUS_NOTIFY_MAX_SUBSCRIBERS,
    )

    const workspaceName = await SdStatusPageRepository.findWorkspaceName(
      incident.workspaceId,
    )
    const connection = audience.some((s) => s.channel === 'WHATSAPP')
      ? await activeWhatsappConnection(incident.workspaceId)
      : null

    const resolved = update.status === 'RESOLVED'
    const incidentRow = await SdMajorIncidentRepository.findById(
      incident.id,
      incident.workspaceId,
    )
    const impact = incidentRow.ok ? incidentRow.value.impact : 'PARTIAL_OUTAGE'

    let sent = 0
    let failed = 0
    for (const subscriber of audience) {
      const pageUrl = `${NEXT_PUBLIC_URL}${sdStatusPagePath(subscriber.pageSlug)}`
      try {
        if (subscriber.channel === 'EMAIL') {
          await sendSdStatusUpdateEmail({
            email: subscriber.address,
            pageName: subscriber.pageName,
            workspaceName: workspaceName.ok ? (workspaceName.value ?? '') : '',
            incidentTitle: incident.title,
            statusLabel: SD_MAJOR_INCIDENT_STATUS_LABEL[update.status],
            impactLabel: SD_MAJOR_INCIDENT_IMPACT_LABEL[impact],
            message: update.message,
            pageUrl,
            unsubscribeUrl: `${NEXT_PUBLIC_URL}${sdStatusSubscriptionPath(subscriber.pageSlug, subscriber.token)}`,
            resolved,
          })
          sent += 1
        } else if (connection) {
          const result = await WhatsAppSend.text(connection, {
            to: subscriber.address,
            text: sdStatusUpdateText({
              pageName: subscriber.pageName,
              incidentTitle: incident.title,
              status: update.status,
              message: update.message,
              url: pageUrl,
            }),
          })
          if (result.ok) sent += 1
          else {
            failed += 1
            logger.warn('servicedesk.status.whatsapp_failed', {
              updateId,
              reason: result.error.code,
            })
          }
          await pause(SD_STATUS_WHATSAPP_GAP_MS)
        } else {
          // No WhatsApp connection for the workspace: nothing to send with.
          failed += 1
        }
      } catch (error) {
        failed += 1
        logger.warn('servicedesk.status.send_failed', {
          updateId,
          channel: subscriber.channel,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const saved = await SdMajorIncidentRepository.finishNotification(updateId, {
      total: audience.length,
      sent,
      failed,
    })
    if (!saved.ok) {
      logger.warn('servicedesk.status.counts_failed', {
        updateId,
        reason: saved.error.code,
      })
    }
    return ok({ skipped: null, total: audience.length, sent, failed })
  },
}
