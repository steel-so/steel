import type { NotificationKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  isConfigurableNotificationKind,
  NOTIFICATION_QUICK_FILTERS,
  type NotificationModule,
  type NotificationQuickFilter,
  notificationKindsOfModule,
} from '@/src/lib/notification-kind'
import { publishNotificationEvent } from '@/src/lib/notifications/realtime'
import {
  DEFAULT_SNOOZE_TIMEZONE,
  snoozeUntil,
} from '@/src/lib/notifications/snooze'
import { ok, type Result } from '@/src/lib/result'
import { toNotificationDTO } from '@/src/mappers/notification.mapper'
import { NotificationRepository } from '@/src/repositories/notification.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import { UserPreferenceRepository } from '@/src/repositories/user-preference.repository'
import type {
  ArchiveReadNotificationsDTO,
  MarkNotificationsReadDTO,
  NotificationBulkActionDTO,
  NotificationListQueryDTO,
  SnoozeNotificationsDTO,
} from '@/src/schemas/notification.schema'
import type {
  NotificationActionResultDTO,
  NotificationListDTO,
  NotificationSnoozeResultDTO,
} from '@/types/notification'
import { assertMember } from './authz'

const LIST_LIMIT = 50

/** Drops the recipients who muted a configurable (non-ServiceDesk) kind. */
async function withoutMuted(
  workspaceId: string,
  kind: NotificationKind,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0 || !isConfigurableNotificationKind(kind)) {
    return userIds
  }
  const muted = await NotificationPreferenceRepository.listMutedUserIds(
    workspaceId,
    kind,
    userIds,
  )
  // Fail open: a preference lookup failure must not drop the notice.
  if (!muted.ok) {
    logger.warn(
      'notifications.preferences_lookup_failed',
      logFields(
        { component: 'NotificationService', workspaceId },
        { kind, reason: muted.error.code },
      ),
    )
    return userIds
  }
  const mutedSet = new Set(muted.value)
  return userIds.filter((userId) => !mutedSet.has(userId))
}

/**
 * Tipos aceitos pelo filtro: o cruzamento de `module` (resolvido pela tabela
 * pura de `kind`), `quick` (conjunto fixo: menções, atribuições) e `kind`.
 * Um cruzamento vazio devolve lista vazia — e não a listagem inteira.
 */
function kindFilter(query: {
  module?: NotificationModule
  kind?: string
  quick?: NotificationQuickFilter
}): string[] | undefined {
  const sets: string[][] = []
  if (query.module) sets.push(notificationKindsOfModule(query.module))
  if (query.quick) sets.push([...NOTIFICATION_QUICK_FILTERS[query.quick]])
  if (query.kind) sets.push([query.kind])
  if (sets.length === 0) return undefined
  return sets.reduce((acc, set) => acc.filter((kind) => set.includes(kind)))
}

/** User's timezone for snooze presets; falls back to the platform default. */
async function userTimeZone(userId: string): Promise<string> {
  const preference = await UserPreferenceRepository.findByUserId(userId)
  return preference.ok ? preference.value.timezone : DEFAULT_SNOOZE_TIMEZONE
}

export const NotificationService = {
  /** Caixa de entrada do usuário no workspace (mais recentes primeiro). */
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<NotificationListDTO>> {
    return NotificationService.listInbox(actorId, workspaceId, {
      folder: 'all',
      limit: LIST_LIMIT,
    })
  },

  /**
   * Caixa de entrada com pastas, filtros, busca e paginação por cursor. Só
   * devolve as notificações de quem chamou — não há visão de administrador.
   */
  async listInbox(
    actorId: string,
    workspaceId: string,
    query: NotificationListQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<NotificationListDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const [page, counts] = await Promise.all([
      NotificationRepository.listPage({
        workspaceId,
        userId: actorId,
        folder: query.folder,
        kinds: kindFilter(query),
        search: query.search,
        cursor: query.cursor,
        limit: query.limit,
        now,
      }),
      NotificationRepository.countFolders(workspaceId, actorId, now),
    ])
    if (!page.ok) return page
    if (!counts.ok) return counts

    return ok({
      items: page.value.items.map(toNotificationDTO),
      unreadCount: counts.value.unread,
      nextCursor: page.value.nextCursor,
      counts: counts.value,
    })
  },

  /**
   * Marca como lidas as próprias notificações: só `ids`, ou todas — e aí
   * `module`/`kind` restringem ao filtro da tela.
   */
  async markRead(
    actorId: string,
    workspaceId: string,
    dto: MarkNotificationsReadDTO,
  ): Promise<Result<NotificationActionResultDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const updated = await NotificationRepository.markRead(
      workspaceId,
      actorId,
      dto.ids,
      dto.ids ? undefined : kindFilter(dto),
    )
    if (!updated.ok) return updated
    return ok({ updated: updated.value })
  },

  /** "Arquivar lidas" (todas, ou só as do `module`/`kind` da tela). */
  async archiveRead(
    actorId: string,
    workspaceId: string,
    dto: ArchiveReadNotificationsDTO,
  ): Promise<Result<NotificationActionResultDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const updated = await NotificationRepository.archiveRead(
      workspaceId,
      actorId,
      kindFilter(dto),
    )
    if (!updated.ok) return updated
    return ok({ updated: updated.value })
  },

  /**
   * Adia as próprias notificações até o horário do preset, no fuso do
   * usuário (preferências pessoais). Voltam como não lidas.
   */
  async snooze(
    actorId: string,
    workspaceId: string,
    dto: SnoozeNotificationsDTO,
    now: Date = new Date(),
  ): Promise<Result<NotificationSnoozeResultDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const until = snoozeUntil(dto.preset, now, await userTimeZone(actorId))
    const updated = await NotificationRepository.snooze({
      workspaceId,
      userId: actorId,
      ids: Array.from(new Set(dto.ids)),
      until,
    })
    if (!updated.ok) return updated

    logger.info(
      'notifications.snoozed',
      logFields(
        { component: 'NotificationService', workspaceId },
        { preset: dto.preset, updated: updated.value },
      ),
    )
    return ok({ updated: updated.value, snoozedUntil: until.toISOString() })
  },

  /**
   * Ação de cliente de e-mail (ler/não ler, arquivar/desarquivar,
   * excluir/restaurar) numa ou em várias notificações. `restore` é o
   * "desfazer" da exclusão. Ids de outra pessoa são ignorados pelo filtro do
   * repositório, então o resultado conta só o que era mesmo do usuário.
   */
  async applyAction(
    actorId: string,
    workspaceId: string,
    dto: NotificationBulkActionDTO,
  ): Promise<Result<NotificationActionResultDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const ids = Array.from(new Set(dto.ids))
    // Só a dupla destrutiva vai para o audit: ler/arquivar o usuário desfaz
    // na própria tela, excluir tira um aviso de vista (LGPD: conteúdo dele).
    const audited =
      dto.action === 'delete' || dto.action === 'restore' ? dto.action : null

    const updated = await NotificationRepository.applyAction({
      workspaceId,
      userId: actorId,
      ids,
      action: dto.action,
    })
    if (!updated.ok) {
      if (audited) {
        auditMutation({
          entity: 'notification',
          action: audited,
          actorId,
          outcome: 'failure',
          reason: updated.error.code,
          meta: { workspaceId, requested: ids.length },
        })
      }
      return updated
    }

    if (audited) {
      auditMutation({
        entity: 'notification',
        action: audited,
        actorId,
        meta: { workspaceId, updated: updated.value },
      })
    }

    return ok({ updated: updated.value })
  },

  /**
   * Cria a mesma notificação para vários usuários. Fluxo de sistema: quem
   * chama já decidiu os destinatários (membros do workspace). Publica o
   * evento genérico de tempo real para a caixa de entrada e o contador do
   * cabeçalho se atualizarem sem recarregar.
   *
   * `actorId` (who caused the event) is never notified about their own
   * action. Non-ServiceDesk kinds honor the per-user mute preferences
   * (`NotificationPreference`); ServiceDesk callers filter with their own.
   * `dedupeKey` makes the call idempotent per user (job re-runs).
   */
  async notifyUsers(input: {
    workspaceId: string
    userIds: string[]
    kind: NotificationKind
    title: string
    body: string
    href?: string
    actorId?: string | null
    dedupeKey?: string
  }): Promise<Result<number>> {
    const candidates = Array.from(new Set(input.userIds)).filter(
      (userId) => !input.actorId || userId !== input.actorId,
    )
    const userIds = await withoutMuted(
      input.workspaceId,
      input.kind,
      candidates,
    )

    const created = await NotificationRepository.createMany(
      userIds.map((userId) => ({
        workspaceId: input.workspaceId,
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
    )
    if (!created.ok || created.value === 0) return created

    await publishNotificationEvent(input.workspaceId, userIds, {
      type: 'notification.created',
      kind: input.kind,
      at: new Date().toISOString(),
      // Lets the client raise a desktop notification without a round trip.
      title: input.title,
      body: input.body,
      href: input.href ?? null,
    })

    return created
  },
}
