import type { NotificationKind } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { NotificationRecipientRepository } from '@/src/repositories/notification-recipient.repository'
import { NotificationService } from './notification.service'

export interface EmitNotificationInput {
  workspaceId: string
  /** Candidates; `null`/`undefined` and duplicates are dropped. */
  recipients: readonly (string | null | undefined)[]
  /** Who caused the event — never notified about their own action. */
  actorId?: string | null
  kind: NotificationKind
  /** pt-BR. */
  title: string
  /** pt-BR. */
  body: string
  /**
   * Path inside the workspace (e.g. `/crm/leads?record=<id>`). The workspace
   * slug is prefixed here, so callers never need to look it up.
   */
  path?: string
  /** Idempotency key (see `Notification.dedupeKey`). */
  dedupeKey?: string
}

/**
 * Fire-and-forget delivery of a system notification from a business flow.
 * It runs after the business write and **never fails it**: every error is
 * logged and swallowed, and the function resolves to the number of
 * notifications created (0 on any failure). Recipients that are no longer
 * workspace members, the actor and users who muted the kind are skipped.
 */
export async function emitNotification(
  input: EmitNotificationInput,
): Promise<number> {
  const candidates = Array.from(
    new Set(
      input.recipients.filter(
        (id): id is string => !!id && id !== input.actorId,
      ),
    ),
  )
  if (candidates.length === 0) return 0

  try {
    const audience = await NotificationRecipientRepository.resolve(
      input.workspaceId,
      candidates,
    )
    if (!audience.ok) {
      logEmitFailure(input, audience.error.code)
      return 0
    }
    if (!audience.value || audience.value.memberIds.length === 0) return 0

    const created = await NotificationService.notifyUsers({
      workspaceId: input.workspaceId,
      userIds: audience.value.memberIds,
      actorId: input.actorId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.path ? `/${audience.value.slug}${input.path}` : undefined,
      dedupeKey: input.dedupeKey,
    })
    if (!created.ok) {
      logEmitFailure(input, created.error.code)
      return 0
    }
    return created.value
  } catch (error) {
    logEmitFailure(
      input,
      error instanceof Error ? error.message : String(error),
    )
    return 0
  }
}

/** OWNER/ADMIN members of the workspace; empty (and logged) on failure. */
export async function workspaceAdminIds(
  workspaceId: string,
): Promise<string[]> {
  const ids =
    await NotificationRecipientRepository.listPrivilegedIds(workspaceId)
  if (!ids.ok) {
    logger.warn(
      'notifications.emit.admins_lookup_failed',
      logFields({ component: 'NotificationEmitter', workspaceId }),
    )
    return []
  }
  return ids.value
}

/** OWNER members of the workspace; empty (and logged) on failure. */
export async function workspaceOwnerIds(
  workspaceId: string,
): Promise<string[]> {
  const ids = await NotificationRecipientRepository.listOwnerIds(workspaceId)
  if (!ids.ok) {
    logger.warn(
      'notifications.emit.owners_lookup_failed',
      logFields({ component: 'NotificationEmitter', workspaceId }),
    )
    return []
  }
  return ids.value
}

/** Every member of the workspace; empty (and logged) on failure. */
export async function workspaceMemberIds(
  workspaceId: string,
): Promise<string[]> {
  const ids = await NotificationRecipientRepository.listMemberIds(workspaceId)
  if (!ids.ok) {
    logger.warn(
      'notifications.emit.members_lookup_failed',
      logFields({ component: 'NotificationEmitter', workspaceId }),
    )
    return []
  }
  return ids.value
}

function logEmitFailure(input: EmitNotificationInput, reason: string) {
  logger.warn(
    'notifications.emit.failed',
    logFields(
      { component: 'NotificationEmitter', workspaceId: input.workspaceId },
      { kind: input.kind, reason },
    ),
  )
}
