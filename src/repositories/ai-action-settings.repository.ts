import type { AiActionSettings, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const AiActionSettingsRepository = {
  async find(workspaceId: string): Promise<Result<AiActionSettings | null>> {
    try {
      return ok(
        await prisma.aiActionSettings.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find AI action settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<Prisma.AiActionSettingsUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<AiActionSettings>> {
    try {
      return ok(
        await prisma.aiActionSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert AI action settings', error))
    }
  },
}
