import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { sendSdStatusMaintenanceEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { ok, type Result } from '@/src/lib/result'
import {
  SD_STATUS_NOTIFY_MAX_SUBSCRIBERS,
  SD_STATUS_WHATSAPP_GAP_MS,
  sdStatusPagePath,
  sdStatusSubscriptionPath,
} from '@/src/lib/servicedesk/major-incident'
import {
  sdFormatMaintenanceDate,
  sdMaintenanceNoticeText,
} from '@/src/lib/servicedesk/status-maintenance'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdStatusMaintenanceRepository } from '@/src/repositories/sd-status-maintenance.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { activeWhatsappConnection } from './sd-notification.service'

export interface SdMaintenanceNotifyResult {
  /** Nothing was sent: the window is gone, was already announced or is off. */
  skipped: 'not_found' | 'disabled' | 'already_sent' | null
  total: number
  sent: number
  failed: number
}

const NONE = (
  skipped: SdMaintenanceNotifyResult['skipped'],
): SdMaintenanceNotifyResult => ({ skipped, total: 0, sent: 0, failed: 0 })

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const HEADLINE = {
  scheduled: 'Manutenção programada',
  rescheduled: 'Manutenção reagendada',
  canceled: 'Manutenção cancelada',
} as const

/**
 * Delivers the notice of a maintenance window to the confirmed subscribers
 * of its published pages (e-mail through Resend, WhatsApp through the
 * workspace's ServiceDesk connection). Idempotent: the notice is claimed
 * (`announcedAt` / `canceledNoticeAt`) before anything is sent, so a retry
 * never repeats it. A failure for one subscriber never stops the others.
 */
export const SdStatusMaintenanceNotifyService = {
  async deliver(
    maintenanceId: string,
    kind: 'scheduled' | 'rescheduled' | 'canceled',
  ): Promise<Result<SdMaintenanceNotifyResult>> {
    const found = await SdStatusMaintenanceRepository.findByIdAny(maintenanceId)
    if (!found.ok) return found
    const window = found.value
    if (!window) return ok(NONE('not_found'))
    if (!window.notifySubscribers) return ok(NONE('disabled'))

    const claimed = await SdStatusMaintenanceRepository.claimNotice(
      maintenanceId,
      kind === 'canceled' ? 'canceled' : 'scheduled',
      new Date(),
    )
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok(NONE('already_sent'))

    const pages = await SdStatusPageRepository.findManyByIds(
      window.workspaceId,
      window.pages.map((link) => link.pageId),
    )
    if (!pages.ok) return pages
    const published = pages.value.filter((page) => page.published)
    const zones = new Map(published.map((page) => [page.id, page.timeZone]))
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
      window.workspaceId,
    )
    const connection = audience.some((s) => s.channel === 'WHATSAPP')
      ? await activeWhatsappConnection(window.workspaceId)
      : null

    let sent = 0
    let failed = 0
    for (const subscriber of audience) {
      const timeZone = zones.get(subscriber.pageId) ?? 'America/Sao_Paulo'
      const pageUrl = `${NEXT_PUBLIC_URL}${sdStatusPagePath(subscriber.pageSlug)}`
      try {
        if (subscriber.channel === 'EMAIL') {
          await sendSdStatusMaintenanceEmail({
            email: subscriber.address,
            pageName: subscriber.pageName,
            workspaceName: workspaceName.ok ? (workspaceName.value ?? '') : '',
            title: window.title,
            headline: HEADLINE[kind],
            whenText: `${sdFormatMaintenanceDate(window.startsAt, timeZone)} até ${sdFormatMaintenanceDate(window.endsAt, timeZone)}`,
            description: window.description,
            pageUrl,
            unsubscribeUrl: `${NEXT_PUBLIC_URL}${sdStatusSubscriptionPath(subscriber.pageSlug, subscriber.token)}`,
            canceled: kind === 'canceled',
          })
          sent += 1
        } else if (connection) {
          const result = await WhatsAppSend.text(connection, {
            to: subscriber.address,
            text: sdMaintenanceNoticeText({
              pageName: subscriber.pageName,
              title: window.title,
              kind,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              timeZone,
              description: window.description,
              url: pageUrl,
            }),
          })
          if (result.ok) sent += 1
          else {
            failed += 1
            logger.warn('servicedesk.status.maintenance_whatsapp_failed', {
              maintenanceId,
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
        logger.warn('servicedesk.status.maintenance_send_failed', {
          maintenanceId,
          channel: subscriber.channel,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const saved = await SdStatusMaintenanceRepository.finishNotice(
      maintenanceId,
      { total: audience.length, sent, failed },
    )
    if (!saved.ok) {
      logger.warn('servicedesk.status.maintenance_counts_failed', {
        maintenanceId,
        reason: saved.error.code,
      })
    }
    return ok({ skipped: null, total: audience.length, sent, failed })
  },
}
