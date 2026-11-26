import type { NotificationDeliverySetting, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Per-user delivery channels of the inbox (no row = defaults). */
export const NotificationDeliverySettingRepository = {
  async find(
    workspaceId: string,
    userId: string,
  ): Promise<Result<NotificationDeliverySetting | null>> {
    try {
      const row = await prisma.notificationDeliverySetting.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find notification delivery setting', error))
    }
  },

  async upsert(
    workspaceId: string,
    userId: string,
    data: Prisma.NotificationDeliverySettingUncheckedUpdateInput,
  ): Promise<Result<NotificationDeliverySetting>> {
    try {
      const row = await prisma.notificationDeliverySetting.upsert({
        where: { userId_workspaceId: { userId, workspaceId } },
        create: {
          ...(data as Prisma.NotificationDeliverySettingUncheckedCreateInput),
          userId,
          workspaceId,
        },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save notification delivery setting', error))
    }
  },

  /**
   * Users (among `userIds`) with the WhatsApp channel on: enabled and the
   * number confirmed by code.
   */
  async listWhatsappTargets(
    workspaceId: string,
    userIds: string[],
  ): Promise<Result<{ userId: string; number: string }[]>> {
    if (userIds.length === 0) return ok([])
    try {
      const rows = await prisma.notificationDeliverySetting.findMany({
        where: {
          workspaceId,
          userId: { in: userIds },
          whatsappEnabled: true,
          whatsappVerifiedAt: { not: null },
          whatsappNumber: { not: null },
        },
        select: { userId: true, whatsappNumber: true },
      })
      return ok(
        rows.flatMap((row) =>
          row.whatsappNumber
            ? [{ userId: row.userId, number: row.whatsappNumber }]
            : [],
        ),
      )
    } catch (error) {
      return err(dbError('Failed to list WhatsApp notification targets', error))
    }
  },
}
