import type { Prisma, SdSwarmMemberStatus, SdSwarmStatus } from '@prisma/client'
import { sdSwarmNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { SD_USER_SUMMARY_SELECT } from './sd-ticket.repository'

const SWARM_INCLUDE = {
  startedBy: { select: SD_USER_SUMMARY_SELECT },
  closedBy: { select: SD_USER_SUMMARY_SELECT },
  members: {
    orderBy: { invitedAt: 'asc' },
    include: { user: { select: SD_USER_SUMMARY_SELECT } },
  },
} satisfies Prisma.SdSwarmInclude

export type SdSwarmRow = Prisma.SdSwarmGetPayload<{
  include: typeof SWARM_INCLUDE
}>

export interface SdSwarmCreateInput {
  workspaceId: string
  ticketId: string
  reason: string
  startedById: string
  memberIds: string[]
}

export interface SdSwarmSlackInput {
  slackChannelId: string | null
  slackChannelName: string | null
  slackError: string | null
}

export const SdSwarmRepository = {
  async create(input: SdSwarmCreateInput): Promise<Result<SdSwarmRow>> {
    try {
      const row = await prisma.sdSwarm.create({
        data: {
          workspaceId: input.workspaceId,
          ticketId: input.ticketId,
          reason: input.reason,
          startedById: input.startedById,
          members: {
            create: input.memberIds.map((userId) => ({
              userId,
              invitedById: input.startedById,
            })),
          },
        },
        include: SWARM_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create ServiceDesk swarm', error))
    }
  },

  async findById(
    swarmId: string,
    ticketId: string,
  ): Promise<Result<SdSwarmRow>> {
    try {
      const row = await prisma.sdSwarm.findFirst({
        where: { id: swarmId, ticketId },
        include: SWARM_INCLUDE,
      })
      return row ? ok(row) : err(sdSwarmNotFound())
    } catch (error) {
      return err(dbError('Failed to find ServiceDesk swarm', error))
    }
  },

  async findOpenByTicket(ticketId: string): Promise<Result<SdSwarmRow | null>> {
    try {
      const row = await prisma.sdSwarm.findFirst({
        where: { ticketId, status: 'OPEN' satisfies SdSwarmStatus },
        include: SWARM_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find open ServiceDesk swarm', error))
    }
  },

  /** Newest first. */
  async listByTicket(ticketId: string): Promise<Result<SdSwarmRow[]>> {
    try {
      const rows = await prisma.sdSwarm.findMany({
        where: { ticketId },
        orderBy: { startedAt: 'desc' },
        include: SWARM_INCLUDE,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk swarms', error))
    }
  },

  /** Whether the user was ever invited to any swarm of the ticket. */
  async isMemberOfTicket(
    ticketId: string,
    userId: string,
  ): Promise<Result<boolean>> {
    try {
      const count = await prisma.sdSwarmMember.count({
        where: { userId, swarm: { ticketId } },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check ServiceDesk swarm member', error))
    }
  },

  /**
   * Invites the users. Declined ones are invited again; the rest are left
   * alone. Returns the ids that got a (new) invitation.
   */
  async invite(
    swarmId: string,
    userIds: string[],
    invitedById: string,
  ): Promise<Result<string[]>> {
    try {
      const invited = await prisma.$transaction(async (tx) => {
        const existing = await tx.sdSwarmMember.findMany({
          where: { swarmId, userId: { in: userIds } },
          select: { userId: true, status: true },
        })
        const byUser = new Map(existing.map((m) => [m.userId, m.status]))
        const fresh = userIds.filter((id) => !byUser.has(id))
        const again = userIds.filter((id) => byUser.get(id) === 'DECLINED')
        if (fresh.length > 0) {
          await tx.sdSwarmMember.createMany({
            data: fresh.map((userId) => ({ swarmId, userId, invitedById })),
          })
        }
        if (again.length > 0) {
          await tx.sdSwarmMember.updateMany({
            where: { swarmId, userId: { in: again } },
            data: {
              status: 'INVITED',
              invitedById,
              invitedAt: new Date(),
              respondedAt: null,
            },
          })
        }
        return [...fresh, ...again]
      })
      return ok(invited)
    } catch (error) {
      return err(dbError('Failed to invite ServiceDesk swarm members', error))
    }
  },

  async respond(
    swarmId: string,
    userId: string,
    status: Extract<SdSwarmMemberStatus, 'JOINED' | 'DECLINED'>,
  ): Promise<Result<true>> {
    try {
      await prisma.sdSwarmMember.update({
        where: { swarmId_userId: { swarmId, userId } },
        data: { status, respondedAt: new Date() },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to answer ServiceDesk swarm invite', error))
    }
  },

  async setSlack(
    swarmId: string,
    input: SdSwarmSlackInput,
  ): Promise<Result<true>> {
    try {
      await prisma.sdSwarm.update({ where: { id: swarmId }, data: input })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to save ServiceDesk swarm channel', error))
    }
  },

  async close(
    swarmId: string,
    input: {
      closedById: string
      outcome: string | null
      slackArchivedAt: Date | null
    },
  ): Promise<Result<true>> {
    try {
      await prisma.sdSwarm.update({
        where: { id: swarmId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: input.closedById,
          outcome: input.outcome,
          slackArchivedAt: input.slackArchivedAt,
        },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to close ServiceDesk swarm', error))
    }
  },
}
