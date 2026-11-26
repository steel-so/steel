import type { NotificationKind, WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  rateLimited,
  validationError,
} from '@/src/errors/app-error'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { isConfigurableNotificationKind } from '@/src/lib/notification-kind'
import {
  decideNoticeRoute,
  formatWhatsAppNotice,
  generateVerificationCode,
  hashVerificationCode,
  maskNotificationNumber,
  NOTICE_TEMPLATE,
  type NoticeSkipReason,
  normalizeNotificationNumber,
  noticeTemplateComponents,
  noticeTemplateParams,
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
import { createMetaTemplate } from '@/src/lib/whatsapp/meta-templates'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { NotificationDeliverySettingRepository } from '@/src/repositories/notification-delivery-setting.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import { SdRequesterWhatsappRepository } from '@/src/repositories/sd-requester-whatsapp.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
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
 * contact's last message; outside it the fixed `steel_aviso` template (made
 * and submitted by the app) carries the notice. Without an approved
 * template the notice is skipped (logged); the in-app notice is never
 * affected. Z-API has no window.
 */

/** First connected Comunicação line of the workspace, oldest first. */
async function pickConnection(
  workspaceId: string,
): Promise<WhatsAppConnection | null> {
  const list = await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
  if (!list.ok) return null
  return list.value.find((c) => c.status === 'CONNECTED') ?? null
}

/** Is the 24 h window open for the number? Z-API has none (always open). */
async function windowOpen(
  workspaceId: string,
  connection: WhatsAppConnection,
  number: string,
): Promise<boolean | null> {
  if (connection.provider !== 'META') return true
  const state = await SdRequesterWhatsappRepository.contactState(
    workspaceId,
    connection.id,
    number,
  )
  if (!state.ok) return null
  return sdWhatsappWindow('META', state.value.lastInboundAt).open
}

/** Status of the notice template on the connection; `null` = not created. */
async function noticeTemplateStatus(
  connection: WhatsAppConnection,
): Promise<string | null> {
  if (connection.provider !== 'META') return null
  const row = await WhatsAppTemplateRepository.findByConnectionAndName(
    connection.id,
    NOTICE_TEMPLATE.name,
    NOTICE_TEMPLATE.language,
  )
  return row.ok && row.value ? row.value.status : null
}

/**
 * Submits the fixed notice template to Meta for the connection (once; Meta
 * approves it in minutes and the template webhook updates the row).
 */
async function ensureNoticeTemplate(
  connection: WhatsAppConnection,
): Promise<boolean> {
  if (!connection.metaWabaId || !connection.encryptedMetaAccessToken) {
    return false
  }
  try {
    const created = await createMetaTemplate({
      wabaId: connection.metaWabaId,
      accessToken: await decryptConnectionSecret(
        connection.encryptedMetaAccessToken,
      ),
      name: NOTICE_TEMPLATE.name,
      language: NOTICE_TEMPLATE.language,
      category: NOTICE_TEMPLATE.category,
      components: noticeTemplateComponents(),
    })
    const saved = await WhatsAppTemplateRepository.upsertSynced({
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      name: NOTICE_TEMPLATE.name,
      language: NOTICE_TEMPLATE.language,
      category: NOTICE_TEMPLATE.category,
      status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
      components: noticeTemplateComponents() as never,
    })
    return saved.ok
  } catch (error) {
    logger.warn(
      'notifications.whatsapp.template_create_failed',
      logFields(
        {
          component: 'NotificationWhatsapp',
          workspaceId: connection.workspaceId,
        },
        { reason: error instanceof Error ? error.message : String(error) },
      ),
    )
    return false
  }
}

const SKIP_MESSAGE: Record<NoticeSkipReason | 'window_unknown', string> = {
  template_missing:
    'Preparamos o modelo de aviso e o enviamos à Meta para aprovação (costuma levar alguns minutos). Tente de novo em instantes.',
  template_pending:
    'O modelo de aviso ainda está em aprovação pela Meta (costuma levar alguns minutos). Tente de novo em instantes.',
  template_unavailable:
    'O modelo de aviso foi recusado ou está pausado na Meta. Peça a um administrador para revisar os templates da conexão.',
  window_unknown:
    'Não foi possível verificar a conversa com a conexão. Tente de novo.',
}

type SendOutcome =
  | { sent: true }
  | { sent: false; reason: NoticeSkipReason | 'window_unknown' | 'failed' }

/**
 * Sends one notice (or the verification code) by the right route: text in
 * the window / Z-API, the approved template outside it. A missing template
 * is submitted to Meta on the way.
 */
async function sendNotice(
  connection: WhatsAppConnection,
  number: string,
  notice: { title: string; body: string; href?: string | null; text?: string },
): Promise<SendOutcome> {
  const open = await windowOpen(connection.workspaceId, connection, number)
  if (open === null) return { sent: false, reason: 'window_unknown' }
  const route = decideNoticeRoute({
    provider: connection.provider,
    windowOpen: open,
    templateStatus: open ? null : await noticeTemplateStatus(connection),
  })
  if (route.route === 'skip') {
    if (route.reason === 'template_missing') {
      await ensureNoticeTemplate(connection)
    }
    return { sent: false, reason: route.reason }
  }
  const sent =
    route.route === 'template'
      ? await WhatsAppSend.template(
          connection,
          {
            to: number,
            templateName: NOTICE_TEMPLATE.name,
            language: NOTICE_TEMPLATE.language,
            components: noticeTemplateParams(notice),
          },
          {
            cost: {
              source: 'OTHER',
              templateCategory: NOTICE_TEMPLATE.category,
            },
          },
        )
      : await WhatsAppSend.text(
          connection,
          { to: number, text: notice.text ?? formatWhatsAppNotice(notice) },
          { cost: { source: 'OTHER' } },
        )
  return sent.ok ? { sent: true } : { sent: false, reason: 'failed' }
}

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
      noticeTemplate:
        connection?.provider === 'META'
          ? ((await noticeTemplateStatus(connection)) ?? 'MISSING')
          : null,
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

    const sent = await sendNotice(connection, number, {
      title: 'Código de verificação',
      body: `Seu código é ${code}. Vale por 10 minutos.`,
      text: verificationMessage(code),
    })
    if (!sent.sent) {
      if (sent.reason !== 'failed') {
        return err(badRequest(SKIP_MESSAGE[sent.reason]))
      }
      logger.warn(
        'notifications.whatsapp.code_send_failed',
        logFields({ component: 'NotificationWhatsapp', workspaceId }),
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
      return err(
        rateLimited(
          WHATSAPP_CODE_TTL_MS / 1000,
          'Muitas tentativas. Peça um novo código.',
        ),
      )
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
      const sent = await sendNotice(connection, target.number, payload)
      if (sent.sent) {
        result.sent += 1
      } else if (sent.reason === 'failed') {
        logger.warn('notifications.whatsapp.failed', log)
        result.failed += 1
      } else {
        logger.info('notifications.whatsapp.skipped', {
          ...log,
          reason: sent.reason,
        })
        result.skipped += 1
      }
    }
    return result
  },
}
