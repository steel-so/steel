import type {
  WhatsAppAgentPresence,
  WhatsAppPresenceStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppAgentPresenceRepository = {
  async find(
    workspaceId: string,
    userId: string,
  ): Promise<Result<WhatsAppAgentPresence | null>> {
    try {
      const row = await prisma.whatsAppAgentPresence.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp agent presence', error))
    }
  },

  /** Rows of the given users (everyone when `userIds` is omitted). */
  async list(
    workspaceId: string,
    userIds?: string[],
  ): Promise<Result<WhatsAppAgentPresence[]>> {
    try {
      const rows = await prisma.whatsAppAgentPresence.findMany({
        where: { workspaceId, ...(userIds ? { userId: { in: userIds } } : {}) },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list whatsapp agent presence', error))
    }
  },

  /** Creates or updates the status; one row per workspace and user. */
  async setStatus(
    workspaceId: string,
    userId: string,
    status: WhatsAppPresenceStatus,
  ): Promise<Result<WhatsAppAgentPresence>> {
    try {
      const row = await prisma.whatsAppAgentPresence.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, status },
        update: { status },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to set whatsapp agent presence', error))
    }
  },

  /** Records the last conversation the distribution gave the agent. */
  async touchLastAssigned(
    workspaceId: string,
    userId: string,
    at: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppAgentPresence.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, lastAssignedAt: at },
        update: { lastAssignedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to record whatsapp agent last assignment', error),
      )
    }
  },
}
