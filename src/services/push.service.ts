import { createHash } from 'node:crypto'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { getVapidKeys } from '@/src/lib/push/vapid'
import { buildPushMessage, isPushNotificationKind } from '@/src/lib/push/push-kinds'
import { sendWebPush } from '@/src/lib/push/web-push'
import { ok, type Result } from '@/src/lib/result'
import { PushSubscriptionRepository } from '@/src/repositories/push-subscription.repository'
import type { CreatePushSubscriptionDTO } from '@/src/schemas/push-subscription.schema'
import type { PushStatusDTO } from '@/types/push-subscription'

/** Devices kept per user; the oldest are dropped on a new registration. */
export const MAX_PUSH_DEVICES_PER_USER = 10

export const PushService = {
  /** Whether push is configured, the public key and the caller's devices. */
  async status(userId: string): Promise<Result<PushStatusDTO>> {
    const vapid = getVapidKeys()
    if (!vapid) return ok({ enabled: false, publicKey: null, devices: 0 })
    const devices = await PushSubscriptionRepository.countByUser(userId)
    if (!devices.ok) return devices
    return ok({
      enabled: true,
      publicKey: vapid.publicKey,
      devices: devices.value,
    })
  },

  /** Registers the caller's device. Inert (no write) while push is OFF. */
  async subscribe(
    userId: string,
    dto: CreatePushSubscriptionDTO,
    userAgent: string | null,
  ): Promise<Result<PushStatusDTO>> {
    if (!getVapidKeys()) return ok({ enabled: false, publicKey: null, devices: 0 })
    const saved = await PushSubscriptionRepository.upsert(userId, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 255) ?? null,
    })
    if (!saved.ok) return saved
    const trimmed = await PushSubscriptionRepository.trimToLatest(
      userId,
      MAX_PUSH_DEVICES_PER_USER,
    )
    if (!trimmed.ok) return trimmed
    auditMutation({
      entity: 'push_subscription',
      action: 'create',
      actorId: userId,
      targetId: saved.value.id,
    })
    return PushService.status(userId)
  },

  /** Removes the caller's device (idempotent). */
  async unsubscribe(
    userId: string,
    endpoint: string,
  ): Promise<Result<PushStatusDTO>> {
    const removed = await PushSubscriptionRepository.deleteByEndpoint(
      userId,
      endpoint,
    )
    if (!removed.ok) return removed
    if (removed.value > 0) {
      auditMutation({
        entity: 'push_subscription',
        action: 'delete',
        actorId: userId,
        targetId: null,
      })
    }
    return PushService.status(userId)
  },

  /**
   * Pushes a notification to the devices of `userIds`. The recipients are the
   * ones `NotificationService.notifyUsers` already filtered by their mute
   * preferences. Never throws, never fails the caller: returns how many pushes
   * were accepted (0 when push is OFF, the kind is not a push kind or on any
   * failure).
   */
  async notifyUsers(input: {
    workspaceId: string
    userIds: string[]
    kind: string
    href?: string | null
  }): Promise<number> {
    try {
      if (!isPushNotificationKind(input.kind)) return 0
      const vapid = getVapidKeys()
      if (!vapid || input.userIds.length === 0) return 0

      const subscriptions = await PushSubscriptionRepository.listByUsers(
        input.userIds,
      )
      if (!subscriptions.ok) {
        logger.warn(
          'push.lookup_failed',
          logFields(
            { component: 'PushService', workspaceId: input.workspaceId },
            { reason: subscriptions.error.code },
          ),
        )
        return 0
      }
      if (subscriptions.value.length === 0) return 0

      const message = buildPushMessage(input.kind, input.href)
      const payload = JSON.stringify(message)
      const topic = createHash('sha256')
        .update(`${input.workspaceId}:${input.kind}:${message.url}`)
        .digest('hex')
        .slice(0, 32)

      const results = await Promise.all(
        subscriptions.value.map(async (subscription) => ({
          id: subscription.id,
          result: await sendWebPush(
            subscription,
            payload,
            vapid,
            { urgency: 'high', ttl: 60 * 60, topic },
          ),
        })),
      )

      const accepted = results.filter(({ result }) => result.ok).map(({ id }) => id)
      const gone = results
        .filter(({ result }) => !result.ok && result.gone)
        .map(({ id }) => id)
      await Promise.all([
        PushSubscriptionRepository.touch(accepted, new Date()),
        PushSubscriptionRepository.deleteByIds(gone),
      ])
      return accepted.length
    } catch (error) {
      logger.warn(
        'push.notify_failed',
        logFields(
          { component: 'PushService', workspaceId: input.workspaceId },
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      )
      return 0
    }
  },
}
