import type { NotificationKind, NotificationPreference } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const NotificationPreferenceRepository = {
  /** Every preference row the user saved in the workspace. */
  async listByUser(
    workspaceId: string,
    userId: string,
  ): Promise<Result<NotificationPreference[]>> {
    try {
      const rows = await prisma.notificationPreference.findMany({
        where: { workspaceId, userId },
        orderBy: { kind: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list notification preferences', error))
    }
  },

  /** Upserts the given kinds in one transaction. Returns how many were saved. */
  async upsertMany(
    workspaceId: string,
    userId: string,
    items: { kind: NotificationKind; inApp?: boolean; whatsapp?: boolean }[],
  ): Promise<Result<number>> {
    try {
      const saved = await prisma.$transaction(
        items.map((item) =>
          prisma.notificationPreference.upsert({
            where: {
              userId_workspaceId_kind: {
                userId,
                workspaceId,
                kind: item.kind,
              },
            },
            create: {
              userId,
              workspaceId,
              kind: item.kind,
              inApp: item.inApp ?? true,
              whatsapp: item.whatsapp ?? null,
            },
            // Only the fields the caller sent change.
            update: {
              ...(item.inApp === undefined ? {} : { inApp: item.inApp }),
              ...(item.whatsapp === undefined
                ? {}
                : { whatsapp: item.whatsapp }),
            },
          }),
        ),
      )
      return ok(saved.length)
    } catch (error) {
      return err(dbError('Failed to save notification preferences', error))
    }
  },

  /** Which of `userIds` muted `kind` in the workspace (no row = enabled). */
  async listMutedUserIds(
    workspaceId: string,
    kind: NotificationKind,
    userIds: string[],
  ): Promise<Result<string[]>> {
    if (userIds.length === 0) return ok([])
    try {
      const rows = await prisma.notificationPreference.findMany({
        where: { workspaceId, kind, inApp: false, userId: { in: userIds } },
        select: { userId: true },
      })
      return ok(rows.map((row) => row.userId))
    } catch (error) {
      return err(dbError('Failed to list muted notification users', error))
    }
  },

  /** The saved WhatsApp choice of `kind` per user (absent/null = default). */
  async listWhatsappChoices(
    workspaceId: string,
    kind: NotificationKind,
    userIds: string[],
  ): Promise<Result<Map<string, boolean | null>>> {
    if (userIds.length === 0) return ok(new Map())
    try {
      const rows = await prisma.notificationPreference.findMany({
        where: { workspaceId, kind, userId: { in: userIds } },
        select: { userId: true, whatsapp: true },
      })
      return ok(new Map(rows.map((row) => [row.userId, row.whatsapp])))
    } catch (error) {
      return err(dbError('Failed to list WhatsApp notification choices', error))
    }
  },
}
