import type { NotificationKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { configurableNotificationKinds } from '@/src/lib/notification-kind'
import { whatsappEnabledForKind } from '@/src/lib/notifications/whatsapp-channel'
import { ok, type Result } from '@/src/lib/result'
import { NotificationDeliverySettingRepository } from '@/src/repositories/notification-delivery-setting.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import type {
  UpdateNotificationDeliveryDTO,
  UpdateNotificationPreferencesDTO,
} from '@/src/schemas/notification-preference.schema'
import type {
  NotificationDeliveryDTO,
  NotificationKindDTO,
  NotificationPreferenceDTO,
} from '@/types/notification'
import { assertMember } from './authz'

/**
 * Per-user in-app preferences for the non-ServiceDesk kinds (CRM,
 * Comunicação, Plataforma). Every configurable kind is listed — a kind
 * without a saved row is enabled.
 */
export const NotificationPreferenceService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NotificationPreferenceDTO[]>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const rows = await NotificationPreferenceRepository.listByUser(
      workspaceId,
      actorId,
    )
    if (!rows.ok) return rows

    const saved = new Map(rows.value.map((row) => [row.kind, row]))
    return ok(
      configurableNotificationKinds().map((info) => ({
        kind: info.kind as NotificationKindDTO,
        module: info.module,
        moduleLabel: info.moduleLabel,
        label: info.label,
        icon: info.icon,
        color: info.color,
        inApp: saved.get(info.kind as NotificationKind)?.inApp ?? true,
        whatsapp: whatsappEnabledForKind(
          info.kind,
          saved.get(info.kind as NotificationKind)?.whatsapp,
        ),
      })),
    )
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateNotificationPreferencesDTO,
  ): Promise<Result<NotificationPreferenceDTO[]>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    // Last write wins per field when the same kind is sent twice.
    const byKind = new Map<string, { inApp?: boolean; whatsapp?: boolean }>()
    for (const p of dto.preferences) {
      byKind.set(p.kind, {
        ...byKind.get(p.kind),
        ...(p.inApp === undefined ? {} : { inApp: p.inApp }),
        ...(p.whatsapp === undefined ? {} : { whatsapp: p.whatsapp }),
      })
    }
    const items = Array.from(byKind, ([kind, value]) => ({
      kind: kind as NotificationKind,
      ...value,
    }))

    const saved = await NotificationPreferenceRepository.upsertMany(
      workspaceId,
      actorId,
      items,
    )
    if (!saved.ok) {
      auditMutation({
        entity: 'notification_preference',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: saved.error.code,
        meta: { workspaceId },
      })
      return saved
    }

    auditMutation({
      entity: 'notification_preference',
      action: 'update',
      actorId,
      meta: {
        workspaceId,
        muted: items.filter((i) => i.inApp === false).map((i) => i.kind),
        unmuted: items.filter((i) => i.inApp === true).map((i) => i.kind),
        whatsappOn: items.filter((i) => i.whatsapp === true).map((i) => i.kind),
        whatsappOff: items
          .filter((i) => i.whatsapp === false)
          .map((i) => i.kind),
      },
    })

    return NotificationPreferenceService.list(actorId, workspaceId)
  },

  /** Delivery channels (browser notifications). Off until the user opts in. */
  async getDelivery(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NotificationDeliveryDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const row = await NotificationDeliverySettingRepository.find(
      workspaceId,
      actorId,
    )
    if (!row.ok) return row
    return ok({ browserEnabled: row.value?.browserEnabled ?? false })
  },

  async updateDelivery(
    actorId: string,
    workspaceId: string,
    dto: UpdateNotificationDeliveryDTO,
  ): Promise<Result<NotificationDeliveryDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const saved = await NotificationDeliverySettingRepository.upsert(
      workspaceId,
      actorId,
      { browserEnabled: dto.browserEnabled },
    )
    if (!saved.ok) {
      auditMutation({
        entity: 'notification_preference',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: saved.error.code,
        meta: { workspaceId, channel: 'browser' },
      })
      return saved
    }

    auditMutation({
      entity: 'notification_preference',
      action: 'update',
      actorId,
      meta: {
        workspaceId,
        channel: 'browser',
        browserEnabled: saved.value.browserEnabled,
      },
    })
    return ok({ browserEnabled: saved.value.browserEnabled })
  },
}
