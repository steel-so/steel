import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Audience lookups for system notifications: who among the candidates is
 * still a workspace member (an ex-member never gets a notification) and the
 * workspace slug the in-app links are built on.
 */
export const NotificationRecipientRepository = {
  /** `null` when the workspace does not exist (deleted mid-flight). */
  async resolve(
    workspaceId: string,
    userIds: string[],
  ): Promise<Result<{ slug: string; memberIds: string[] } | null>> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          slug: true,
          memberships: {
            where: { userId: { in: userIds } },
            select: { userId: true },
          },
        },
      })
      if (!workspace) return ok(null)
      return ok({
        slug: workspace.slug,
        memberIds: workspace.memberships.map((m) => m.userId),
      })
    } catch (error) {
      return err(dbError('Failed to resolve notification recipients', error))
    }
  },

  /** OWNER and ADMIN members of the workspace. */
  async listPrivilegedIds(workspaceId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true },
      })
      return ok(rows.map((row) => row.userId))
    } catch (error) {
      return err(dbError('Failed to list workspace admins', error))
    }
  },

  /** OWNER members of the workspace (billing contacts). */
  async listOwnerIds(workspaceId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId, role: 'OWNER' },
        select: { userId: true },
      })
      return ok(rows.map((row) => row.userId))
    } catch (error) {
      return err(dbError('Failed to list workspace owners', error))
    }
  },
  /** Every member of the workspace, whatever the role. */
  async listMemberIds(workspaceId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId },
        select: { userId: true },
      })
      return ok(rows.map((row) => row.userId))
    } catch (error) {
      return err(dbError('Failed to list workspace members', error))
    }
  },
}
