import type { NotificationKind, WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  rateLimited,
  validationError,
} from '@/src/errors/app-error'
import { isConfigurableNotificationKind } from '@/src/lib/notification-kind'
import {
  formatWhatsAppNotice,
  generateVerificationCode,
  hashVerificationCode,
  maskNotificationNumber,
  normalizeNotificationNumber,
  verificationCodeMatches,
  verificationMessage,
  WHATSAPP_CODE_MAX_ATTEMPTS,
  WHATSAPP_CODE_TTL_MS,
  whatsappEnabledForKind,
} from '@/src/lib/notifications/whatsapp-channel'
import { NotificationsJob } from '@/src/lib/queue/jobs'
import { getNotificationsQueue } from '@/src/lib/queue/queues'
import { consume, otpLimiter } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { sdWhatsappWindow } from '@/src/lib/servicedesk/whatsapp'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { NotificationDeliverySettingRepository } from '@/src/repositories/notification-delivery-setting.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import { SdRequesterWhatsappRepository } from '@/src/repositories/sd-requester-whatsapp.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type { NotificationWhatsappDTO } from '@/types/notification'
import { assertMember } from './authz'
import { checkWhatsAppOptOut } from './whatsapp-opt-out'

/**
 * Platform notices on the user's WhatsApp, through the workspace's own
 * Comunicação connection. The number only counts after the user types the
 * code we send to it — otherwise anyone could point the workspace at a
 * stranger's phone.
 *
 * Meta lines (official API) accept free text only within 24 h of the
 * contact's last message; outside it the notice is skipped (logged), the
 * in-app notice is never affected. Z-API has no window.
 */

/** First connected Comunicação line of the workspace, oldest first. */
async function pickConnection(
  workspaceId: string,
): Promise<WhatsAppConnection | null> {
  const list = await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
  if (!list.ok) return null
  return list.value.find((c) => c.status === 'CONNECTED') ?? null
}

/** Window rule shared by the code and the notices; `null` = can send. */
async function windowBlock(
  workspaceId: string,
  connection: WhatsAppConnection,
  number: string,
): Promise<string | null> {
  if (connection.provider !== 'META') return null
  const state = await SdRequesterWhatsappRepository.contactState(
    workspaceId,
    connection.id,
    number,
  )
  if (!state.ok) return 'lookup_failed'
  const window = sdWhatsappWindow('META', state.value.lastInboundAt)
  return window.open ? null : 'window_closed'
}

const WINDOW_HELP =
  'A conexão é da API oficial da Meta: antes de receber o código, envie uma mensagem (ex.: "oi") do seu WhatsApp para o número da conexão e tente de novo.'

export const NotificationWhatsappService = {
  async status(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NotificationWhatsappDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const row = await NotificationDeliverySettingRepository.find(
      workspaceId,
      actorId,
    )
    if (!row.ok) return row
    const connection = await pickConnection(workspaceId)
    const verified = !!row.value?.whatsappVerifiedAt
    return ok({
      available: connection !== null,
      provider: connection?.provider ?? null,
      enabled: verified && (row.value?.whatsappEnabled ?? false),
      verified,
      numberMasked: row.value?.whatsappNumber
        ? maskNotificationNumber(row.value.whatsappNumber)
        : null,
      codePending:
        !verified &&
        !!row.value?.whatsappCodeHash &&
        (row.value.whatsappCodeExpiresAt?.getTime() ?? 0) > Date.now(),
    })
  },

  /** Saves the number as pending and sends the 6-digit code to it. */
  async requestCode(
    actorId: string,
    workspaceId: string,
    rawNumber: string,
  ): Promise<Result<NotificationWhatsappDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const number = normalizeNotificationNumber(rawNumber)
    if (!number) {
      return err(
        validationError('Informe um número com DDD, ex.: 11 99999-0000'),
      )
    }
    const limit = await consume(otpLimiter, `notif-wa:${actorId}`)
    if (!limit.ok) return limit
    const connection = await pickConnection(workspaceId)
    if (!connection) {
      return err(
        badRequest(
          'Nenhuma conexão da Comunicação está conectada neste workspace.',
        ),
      )
    }
    if (await windowBlock(workspaceId, connection, number)) {
      return err(badRequest(WINDOW_HELP))
    }

    const code = generateVerificationCode()
    const saved = await NotificationDeliverySettingRepository.upsert(
      workspaceId,
      actorId,
      {
        whatsappNumber: number,
        whatsappEnabled: false,
        whatsappVerifiedAt: null,
        whatsappCodeHash: hashVerificationCode(actorId, number, code),
        whatsappCodeExpiresAt: new Date(Date.now() + WHATSAPP_CODE_TTL_MS),
        whatsappCodeAttempts: 0,
      },
    )
    if (!saved.ok) return saved

    const sent = await WhatsAppSend.text(connection, {
      to: number,
      text: verificationMessage(code),
    })
    if (!sent.ok) {
      logger.warn(
        'notifications.whatsapp.code_send_failed',
        logFields(
          { component: 'NotificationWhatsapp', workspaceId },
          { reason: sent.error.code },
        ),
      )
      return err(
        badRequest(
          'Não foi possível enviar o código para esse número. Confira o número e tente de novo.',
        ),
      )
    }
    return NotificationWhatsappService.status(actorId, workspaceId)
  },

  /** Checks the code; on success the channel is switched on. */
  async confirm(
    actorId: string,
    workspaceId: string,
    code: string,
  ): Promise<Result<NotificationWhatsappDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const row = await NotificationDeliverySettingRepository.find(
      workspaceId,
      actorId,
    )
    if (!row.ok) return row
    const setting = row.value
    if (
      !setting?.whatsappNumber ||
      !setting.whatsappCodeHash ||
      !setting.whatsappCodeExpiresAt ||
      setting.whatsappCodeExpiresAt.getTime() < Date.now()
    ) {
      return err(badRequest('O código expirou. Peça um novo.'))
    }
    if (setting.whatsappCodeAttempts >= WHATSAPP_CODE_MAX_ATTEMPTS) {
      return err(rateLimited('Muitas tentativas. Peça um novo código.'))
    }

    const matches = verificationCodeMatches(
      actorId,
      setting.whatsappNumber,
      code,
      setting.whatsappCodeHash,
    )
    if (!matches) {
      await NotificationDeliverySettingRepository.upsert(workspaceId, actorId, {
        whatsappCodeAttempts: { increment: 1 },
      })
      return err(badRequest('Código incorreto.'))
    }

    const saved = await NotificationDeliverySettingRepository.upsert(
      workspaceId,
      actorId,
      {
        whatsappEnabled: true,
        whatsappVerifiedAt: new Date(),
        whatsappCodeHash: null,
        whatsappCodeExpiresAt: null,
        whatsappCodeAttempts: 0,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'notification_preference',
      action: 'update',
      actorId,
      meta: { workspaceId, channel: 'whatsapp', whatsappEnabled: true },
    })
    return NotificationWhatsappService.status(actorId, workspaceId)
  },

  /** Pauses or resumes the verified channel without losing the number. */
  async setEnabled(
    actorId: string,
    workspaceId: string,
    enabled: boolean,
  ): Promise<Result<NotificationWhatsappDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const row = await NotificationDeliverySettingRepository.find(
      workspaceId,
      actorId,
    )
    if (!row.ok) return row
    if (!row.value?.whatsappVerifiedAt) {
      return err(badRequest('Confirme o número antes de ativar o canal.'))
    }
    const saved = await NotificationDeliverySettingRepository.upsert(
      workspaceId,
      actorId,
      { whatsappEnabled: enabled },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'notification_preference',
      action: 'update',
      actorId,
      meta: { workspaceId, channel: 'whatsapp', whatsappEnabled: enabled },
    })
    return NotificationWhatsappService.status(actorId, workspaceId)
  },

  /** Forgets the number and everything pending. */
  async remove(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NotificationWhatsappDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const saved = await NotificationDeliverySettingRepository.upsert(
      workspaceId,
      actorId,
      {
        whatsappEnabled: false,
        whatsappNumber: null,
        whatsappVerifiedAt: null,
        whatsappCodeHash: null,
        whatsappCodeExpiresAt: null,
        whatsappCodeAttempts: 0,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'notification_preference',
      action: 'delete',
      actorId,
      meta: { workspaceId, channel: 'whatsapp' },
    })
    return NotificationWhatsappService.status(actorId, workspaceId)
  },

  /**
   * Called by `NotificationService.notifyUsers` after the inbox rows exist.
   * Queues one job for the users who have the channel on and chose this
   * kind. Never throws and never fails the notice.
   */
  async enqueue(input: {
    workspaceId: string
    userIds: string[]
    kind: NotificationKind
    title: string
    body: string
    href: string | null
    dedupeKey?: string | null
  }): Promise<void> {
    try {
      // ServiceDesk kinds keep their own preferences and channels.
      if (!isConfigurableNotificationKind(input.kind)) return
      const targets =
        await NotificationDeliverySettingRepository.listWhatsappTargets(
          input.workspaceId,
          input.userIds,
        )
      if (!targets.ok || targets.value.length === 0) return
      const choices =
        await NotificationPreferenceRepository.listWhatsappChoices(
          input.workspaceId,
          input.kind,
          targets.value.map((t) => t.userId),
        )
      const saved = choices.ok
        ? choices.value
        : new Map<string, boolean | null>()
      const userIds = targets.value
        .map((t) => t.userId)
        .filter((userId) =>
          whatsappEnabledForKind(input.kind, saved.get(userId)),
        )
      if (userIds.length === 0) return
      await getNotificationsQueue().add(
        NotificationsJob.WhatsappDeliver,
        {
          workspaceId: input.workspaceId,
          userIds,
          kind: input.kind,
          title: input.title,
          body: input.body,
          href: input.href,
        },
        input.dedupeKey
          ? { jobId: `wa-notice:${input.workspaceId}:${input.dedupeKey}` }
          : undefined,
      )
    } catch (error) {
      logger.warn(
        'notifications.whatsapp.enqueue_failed',
        logFields(
          { component: 'NotificationWhatsapp', workspaceId: input.workspaceId },
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      )
    }
  },

  /** Worker side: sends the notice to each user's verified number. */
  async deliver(payload: {
    workspaceId: string
    userIds: string[]
    kind: string
    title: string
    body: string
    href: string | null
  }): Promise<{ sent: number; skipped: number; failed: number }> {
    const result = { sent: 0, skipped: 0, failed: 0 }
    const connection = await pickConnection(payload.workspaceId)
    const targets =
      await NotificationDeliverySettingRepository.listWhatsappTargets(
        payload.workspaceId,
        payload.userIds,
      )
    if (!connection || !targets.ok) {
      result.skipped = payload.userIds.length
      return result
    }
    const text = formatWhatsAppNotice(payload)
    for (const target of targets.value) {
      const log = { workspaceId: payload.workspaceId, kind: payload.kind }
      // The user opted out ("sair") or the lookup failed: fail closed.
      if (
        (await checkWhatsAppOptOut(payload.workspaceId, target.number)) !==
        'allowed'
      ) {
        result.skipped += 1
        continue
      }
      const blocked = await windowBlock(
        payload.workspaceId,
        connection,
        target.number,
      )
      if (blocked) {
        logger.info('notifications.whatsapp.skipped', {
          ...log,
          reason: blocked,
        })
        result.skipped += 1
        continue
      }
      const sent = await WhatsAppSend.text(
        connection,
        { to: target.number, text },
        { cost: { source: 'OTHER' } },
      )
      if (sent.ok) {
        result.sent += 1
      } else {
        logger.warn('notifications.whatsapp.failed', {
          ...log,
          reason: sent.error.code,
        })
        result.failed += 1
      }
    }
    return result
  },
}
