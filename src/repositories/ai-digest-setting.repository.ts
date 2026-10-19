import type { AiDigestSetting } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Per-user daily digest channels and last send (ADR 0040). */
export const AiDigestSettingRepository = {
  async find(
    workspaceId: string,
    userId: string,
  ): Promise<Result<AiDigestSetting | null>> {
    try {
      const row = await prisma.aiDigestSetting.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find AI digest setting', error))
    }
  },

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<AiDigestSetting[]>> {
    try {
      const rows = await prisma.aiDigestSetting.findMany({
        where: { workspaceId },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list AI digest settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    userId: string,
    data: { inApp?: boolean; email?: boolean },
  ): Promise<Result<AiDigestSetting>> {
    try {
      const row = await prisma.aiDigestSetting.upsert({
        where: { userId_workspaceId: { userId, workspaceId } },
        create: { workspaceId, userId, ...data },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save AI digest setting', error))
    }
  },

  /** Records the local day a digest went out (once a day per user). */
  async markSent(
    workspaceId: string,
    userId: string,
    day: string,
  ): Promise<Result<AiDigestSetting>> {
    try {
      const row = await prisma.aiDigestSetting.upsert({
        where: { userId_workspaceId: { userId, workspaceId } },
        create: { workspaceId, userId, lastSentOn: day },
        update: { lastSentOn: day },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to mark AI digest as sent', error))
    }
  },
}
