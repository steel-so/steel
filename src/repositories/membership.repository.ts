import type { Membership, Profile, Role, Workspace } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type MembershipWithWorkspace = Membership & { workspace: Workspace }
export type MembershipWithProfile = Membership & {
  profile: Profile | null
  /** Status do workspace, para o gate de suspensão (`assertMember`). */
  workspace?: Pick<Workspace, 'status' | 'allowedIps'>
}

/** Membership with the user fields the member directory shows. */
export type MembershipWithUser = Membership & {
  user: {
    id: string
    name: string
    username: string
    email: string
    image: string | null
    emailVerified: boolean
    twoFactorEnabled: boolean
    deletionScheduledAt: Date | null
    accounts: { providerId: string }[]
  }
}

export const MembershipRepository = {
  async findByUserAndWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<Result<MembershipWithProfile | null>> {
    try {
      const membership = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        include: {
          profile: true,
          workspace: { select: { status: true, allowedIps: true } },
        },
      })
      return ok(membership)
    } catch (error) {
      return err(dbError('Failed to find membership', error))
    }
  },

  async findByUserAndSlug(
    userId: string,
    slug: string,
  ): Promise<Result<MembershipWithWorkspace | null>> {
    try {
      const membership = await prisma.membership.findFirst({
        where: { userId, workspace: { slug } },
        include: { workspace: true },
      })
      return ok(membership)
    } catch (error) {
      return err(dbError('Failed to find membership by slug', error))
    }
  },

  async listByUser(userId: string): Promise<Result<MembershipWithWorkspace[]>> {
    try {
      const memberships = await prisma.membership.findMany({
        where: { userId },
        include: { workspace: true },
        orderBy: { createdAt: 'asc' },
      })
      return ok(memberships)
    } catch (error) {
      return err(dbError('Failed to list memberships', error))
    }
  },

  async create(data: {
    userId: string
    workspaceId: string
    role?: Role
  }): Promise<Result<Membership>> {
    try {
      const membership = await prisma.membership.create({ data })
      return ok(membership)
    } catch (error) {
      return err(dbError('Failed to create membership', error))
    }
  },

  async countByWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      const count = await prisma.membership.count({
        where: { workspaceId },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Faield to count memberships', error))
    }
  },

  async listUserByWorkspace(workspaceId: string) {
    try {
      const memberships = await prisma.membership.findMany({
        where: { workspaceId },
        select: { userId: true },
      })
      return ok(memberships.map((m) => m.userId))
    } catch (error) {
      return err(dbError('Failed to list membership user ids', error))
    }
  },

  async setProfile(
    userId: string,
    workspaceId: string,
    profileId: string | null,
  ): Promise<Result<Membership>> {
    try {
      const membership = await prisma.membership.update({
        where: { userId_workspaceId: { userId, workspaceId } },
        data: { profileId },
      })
      return ok(membership)
    } catch (error) {
      return err(dbError('Failed to set membership profile', error))
    }
  },

  async listWithUserByWorkspace(workspaceId: string): Promise<
    Result<
      (Membership & {
        user: { id: string; name: string; email: string; image: string | null }
      })[]
    >
  > {
    try {
      const memberships = await prisma.membership.findMany({
        where: { workspaceId },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return ok(memberships)
    } catch (error) {
      return err(dbError('Failed to list workspace members', error))
    }
  },

  async listByWorkspaceWithUser(
    workspaceId: string,
    filters: { search?: string; roles?: Role[] },
  ): Promise<Result<MembershipWithUser[]>> {
    try {
      const memberships = await prisma.membership.findMany({
        where: {
          workspaceId,
          ...(filters.roles?.length ? { role: { in: filters.roles } } : {}),
          ...(filters.search
            ? {
                user: {
                  OR: [
                    { name: { contains: filters.search, mode: 'insensitive' } },
                    {
                      username: {
                        contains: filters.search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      email: { contains: filters.search, mode: 'insensitive' },
                    },
                  ],
                },
              }
            : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              email: true,
              image: true,
              emailVerified: true,
              twoFactorEnabled: true,
              deletionScheduledAt: true,
              accounts: { select: { providerId: true } },
            },
          },
        },
      })
      return ok(memberships)
    } catch (error) {
      return err(dbError('Failed to list workspace members with user', error))
    }
  },

  async updateRole(
    userId: string,
    workspaceId: string,
    role: Role,
  ): Promise<Result<Membership>> {
    try {
      const membership = await prisma.membership.update({
        where: { userId_workspaceId: { userId, workspaceId } },
        data: { role },
      })
      return ok(membership)
    } catch (error) {
      return err(dbError('Failed to update membership role', error))
    }
  },

  /**
   * Removes the user from the workspace and from every project of it, in one
   * transaction (project membership has no FK to the workspace membership).
   */
  async remove(userId: string, workspaceId: string): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.projectMember.deleteMany({
          where: { userId, project: { workspaceId } },
        }),
        prisma.membership.delete({
          where: { userId_workspaceId: { userId, workspaceId } },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to remove membership', error))
    }
  },
}
