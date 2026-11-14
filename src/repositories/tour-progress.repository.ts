import type { UserTourProgress } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { err, ok, type Result } from '../lib/result'
import type { MarkTourSeenDTO } from '../schemas/tour-progress.schema'
import { dbError } from './db-error'

export const TourProgressRepository = {
  async listByUser(userId: string): Promise<Result<UserTourProgress[]>> {
    try {
      const rows = await prisma.userTourProgress.findMany({
        where: { userId },
        orderBy: { tourKey: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list tour progress', error))
    }
  },

  /** One row per user and tour: seeing it again overwrites the last record. */
  async upsert(
    userId: string,
    data: MarkTourSeenDTO,
  ): Promise<Result<UserTourProgress>> {
    try {
      const seenAt = new Date()
      const row = await prisma.userTourProgress.upsert({
        where: { userId_tourKey: { userId, tourKey: data.key } },
        create: {
          userId,
          tourKey: data.key,
          version: data.version,
          status: data.status,
          seenAt,
        },
        update: { version: data.version, status: data.status, seenAt },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save tour progress', error))
    }
  },
}
