import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const LOCK_MAX_WAIT_MS = 5_000
const LOCK_TIMEOUT_MS = 15_000

export const WhatsAppDistributionRepository = {
  /**
   * Runs `fn` while holding a Postgres advisory lock named `key` (released
   * when the transaction ends). Two callers with the same key never overlap,
   * across processes and replicas — the distribution picks an agent and
   * claims the conversation inside it so concurrent messages see each
   * other's assignment. The transaction only holds the lock; `fn` queries
   * through the regular client.
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<Result<T>>,
  ): Promise<Result<T>> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
          return fn()
        },
        { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_TIMEOUT_MS },
      )
    } catch (error) {
      return err(dbError('Failed to lock whatsapp distribution', error))
    }
  },

  /** Round-robin pointer of the conversations without a team. */
  async setWorkspacePointer(
    workspaceId: string,
    userId: string,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppSettings.updateMany({
        where: { workspaceId },
        data: { distributionLastAssignedUserId: userId },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to set whatsapp distribution pointer', error))
    }
  },

  async setTeamPointer(teamId: string, userId: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppTeam.updateMany({
        where: { id: teamId },
        data: { distributionLastAssignedUserId: userId },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to set whatsapp team distribution pointer', error),
      )
    }
  },

  async getTeamPointer(teamId: string): Promise<Result<string | null>> {
    try {
      const team = await prisma.whatsAppTeam.findUnique({
        where: { id: teamId },
        select: { distributionLastAssignedUserId: true },
      })
      return ok(team?.distributionLastAssignedUserId ?? null)
    } catch (error) {
      return err(
        dbError('Failed to read whatsapp team distribution pointer', error),
      )
    }
  },

  /** Workspaces that turned the automatic distribution on. */
  async listEnabledWorkspaceIds(): Promise<Result<string[]>> {
    try {
      const rows = await prisma.whatsAppSettings.findMany({
        where: { distributionMode: { not: 'OFF' } },
        select: { workspaceId: true },
      })
      return ok(rows.map((row) => row.workspaceId))
    } catch (error) {
      return err(dbError('Failed to list distribution workspaces', error))
    }
  },
}
