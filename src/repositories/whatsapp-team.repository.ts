import type { Prisma, WhatsAppTeamRole } from '@prisma/client'
import { whatsappTeamConflict } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { WhatsAppTeamSnapshot } from '@/src/lib/whatsapp/conversation-scope'
import { dbError } from './db-error'

const teamInclude = {
  members: {
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.WhatsAppTeamInclude

export type WhatsAppTeamWithMembers = Prisma.WhatsAppTeamGetPayload<{
  include: typeof teamInclude
}>

export interface WhatsAppTeamMemberInput {
  userId: string
  role: WhatsAppTeamRole
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

export const WhatsAppTeamRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppTeamWithMembers[]>> {
    try {
      const teams = await prisma.whatsAppTeam.findMany({
        where: { workspaceId },
        include: teamInclude,
        orderBy: { name: 'asc' },
      })
      return ok(teams)
    } catch (error) {
      return err(dbError('Failed to list whatsapp teams', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppTeamWithMembers | null>> {
    try {
      const team = await prisma.whatsAppTeam.findFirst({
        where: { id, workspaceId },
        include: teamInclude,
      })
      return ok(team)
    } catch (error) {
      return err(dbError('Failed to find whatsapp team', error))
    }
  },

  /** Teams and their members' roles — the input of the visibility rule. */
  async listMembershipSnapshot(
    workspaceId: string,
  ): Promise<Result<WhatsAppTeamSnapshot[]>> {
    try {
      const teams = await prisma.whatsAppTeam.findMany({
        where: { workspaceId },
        select: {
          id: true,
          members: { select: { userId: true, role: true } },
        },
        orderBy: { id: 'asc' },
      })
      return ok(teams)
    } catch (error) {
      return err(dbError('Failed to list whatsapp team memberships', error))
    }
  },

  async create(data: {
    workspaceId: string
    name: string
    description?: string | null
    members: WhatsAppTeamMemberInput[]
  }): Promise<Result<WhatsAppTeamWithMembers>> {
    try {
      const team = await prisma.whatsAppTeam.create({
        data: {
          workspaceId: data.workspaceId,
          name: data.name,
          description: data.description ?? null,
          members: { create: data.members },
        },
        include: teamInclude,
      })
      return ok(team)
    } catch (error) {
      if (isUniqueViolation(error)) return err(whatsappTeamConflict())
      return err(dbError('Failed to create whatsapp team', error))
    }
  },

  /** `members`, when given, replaces the whole member list. */
  async update(
    id: string,
    data: {
      name?: string
      description?: string | null
      members?: WhatsAppTeamMemberInput[]
    },
  ): Promise<Result<WhatsAppTeamWithMembers>> {
    try {
      const team = await prisma.whatsAppTeam.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.members
            ? { members: { deleteMany: {}, create: data.members } }
            : {}),
        },
        include: teamInclude,
      })
      return ok(team)
    } catch (error) {
      if (isUniqueViolation(error)) return err(whatsappTeamConflict())
      return err(dbError('Failed to update whatsapp team', error))
    }
  },

  /** Conversations of the team keep going, without a team (FK set null). */
  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppTeam.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp team', error))
    }
  },
}
