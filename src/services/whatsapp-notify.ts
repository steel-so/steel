import type { NotificationKind } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { emitNotification, workspaceAdminIds } from './notification-emitter'

/**
 * Inbox notices of the Comunicação (WhatsApp) module, on top of the shared
 * `emitNotification` (membership check, actor exclusion, per-user mute,
 * workspace slug in the link). It **never fails the caller**: a notice can't
 * break the business operation that triggered it.
 */

/** Admins told about a module-wide event, at most (no fan-out storm). */
export const WHATSAPP_NOTIFY_ADMIN_CAP = 20

export interface WhatsAppNotifyInput {
  workspaceId: string
  kind: NotificationKind
  userIds: (string | null | undefined)[]
  /** Who caused the event — never notified. */
  actorId?: string | null
  title: string
  body: string
  /** Path inside the workspace (the slug is prefixed by the emitter). */
  path: string
  /** Idempotency key: the same key never notifies the same user twice. */
  dedupeKey?: string
  /** Extra context for the log. */
  meta?: Record<string, unknown>
}

/** Delivers the notice; returns how many inbox rows were created. */
export async function notifyWhatsAppUsers(
  input: WhatsAppNotifyInput,
): Promise<number> {
  const created = await emitNotification({
    workspaceId: input.workspaceId,
    recipients: input.userIds,
    actorId: input.actorId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    path: input.path,
    dedupeKey: input.dedupeKey,
  })
  logger.info('whatsapp.notify.delivered', {
    workspaceId: input.workspaceId,
    kind: input.kind,
    recipients: created,
    ...input.meta,
  })
  return created
}

/** OWNER/ADMIN members, capped. Empty on failure (logged by the emitter). */
export async function whatsAppAdminIds(workspaceId: string): Promise<string[]> {
  const admins = await workspaceAdminIds(workspaceId)
  return admins.slice(0, WHATSAPP_NOTIFY_ADMIN_CAP)
}

/** Path of a conversation in the Comunicação inbox. */
export function whatsAppConversationPath(conversationId: string): string {
  return `/zap?conversa=${conversationId}`
}
