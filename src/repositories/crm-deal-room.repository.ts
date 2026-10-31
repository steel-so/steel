import { randomBytes } from 'node:crypto'
import type {
  CrmDealRoomActionOwner,
  CrmDealRoomAuthorKind,
  CrmDealRoomEvent,
  CrmDealRoomEventKind,
  CrmDealRoomMessage,
  CrmDealRoomVisitor,
  Prisma,
} from '@prisma/client'
import { crmDealRoomNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { UpsertCrmDealRoomDTO } from '@/src/schemas/crm-deals.schema'
import { dbError } from './db-error'

const roomInclude = {
  materials: { orderBy: { position: 'asc' } },
  actions: { orderBy: { position: 'asc' } },
} satisfies Prisma.CrmDealRoomInclude

export type CrmDealRoomFull = Prisma.CrmDealRoomGetPayload<{
  include: typeof roomInclude
}>

const publicInclude = {
  ...roomInclude,
  workspace: { select: { name: true } },
  opportunity: {
    select: { name: true, company: { select: { name: true } } },
  },
  proposal: { select: { id: true, name: true, shareToken: true, status: true } },
} satisfies Prisma.CrmDealRoomInclude

export type CrmDealRoomPublicRow = Prisma.CrmDealRoomGetPayload<{
  include: typeof publicInclude
}>

export type CrmDealRoomEventWithVisitor = CrmDealRoomEvent & {
  visitor: Pick<CrmDealRoomVisitor, 'name' | 'email'> | null
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

export const CrmDealRoomRepository = {
  async findByOpportunity(
    opportunityId: string,
    workspaceId: string,
  ): Promise<Result<CrmDealRoomFull | null>> {
    try {
      return ok(
        await prisma.crmDealRoom.findFirst({
          where: { opportunityId, workspaceId },
          include: roomInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM deal room', error))
    }
  },

  /** Enabled room behind a public token. */
  async findPublicByToken(
    token: string,
  ): Promise<Result<CrmDealRoomPublicRow>> {
    try {
      const room = await prisma.crmDealRoom.findFirst({
        where: { token, enabled: true },
        include: publicInclude,
      })
      return room ? ok(room) : err(crmDealRoomNotFound())
    } catch (error) {
      return err(dbError('Failed to find CRM deal room by token', error))
    }
  },

  /**
   * Creates the room of a deal or updates it. Materials and actions are
   * replaced by id: the ones missing from the input are removed, the ones with
   * an id are updated, the rest are created, all keeping the input order.
   */
  async upsert(input: {
    workspaceId: string
    opportunityId: string
    actorId: string
    actorName: string
    data: UpsertCrmDealRoomDTO
    now: Date
  }): Promise<Result<CrmDealRoomFull>> {
    const { workspaceId, opportunityId, actorId, actorName, data, now } = input
    try {
      const roomId = await prisma.$transaction(async (tx) => {
        const existing = await tx.crmDealRoom.findFirst({
          where: { opportunityId, workspaceId },
        })
        const fields = {
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.title !== undefined && { title: data.title }),
          ...(data.welcomeMessage !== undefined && {
            welcomeMessage: data.welcomeMessage,
          }),
          ...(data.proposalId !== undefined && { proposalId: data.proposalId }),
        }
        const room = existing
          ? await tx.crmDealRoom.update({
              where: { id: existing.id },
              data: {
                ...fields,
                ...(data.rotateToken && { token: newToken() }),
              },
            })
          : await tx.crmDealRoom.create({
              data: {
                workspaceId,
                opportunityId,
                createdById: actorId,
                token: newToken(),
                ...fields,
              },
            })

        if (data.materials) {
          const keep = data.materials.flatMap((m) => (m.id ? [m.id] : []))
          await tx.crmDealRoomMaterial.deleteMany({
            where: { roomId: room.id, id: { notIn: keep } },
          })
          for (const [position, material] of data.materials.entries()) {
            const values = { title: material.title, url: material.url, position }
            if (material.id) {
              await tx.crmDealRoomMaterial.updateMany({
                where: { id: material.id, roomId: room.id },
                data: values,
              })
            } else {
              await tx.crmDealRoomMaterial.create({
                data: { roomId: room.id, ...values },
              })
            }
          }
        }

        if (data.actions) {
          const keep = data.actions.flatMap((a) => (a.id ? [a.id] : []))
          await tx.crmDealRoomAction.deleteMany({
            where: { roomId: room.id, id: { notIn: keep } },
          })
          for (const [position, action] of data.actions.entries()) {
            const values = {
              title: action.title,
              owner: action.owner,
              dueDate: action.dueDate ?? null,
              position,
              ...(action.done === true && {
                doneAt: now,
                doneByLabel: actorName,
              }),
              ...(action.done === false && { doneAt: null, doneByLabel: null }),
            }
            if (action.id) {
              await tx.crmDealRoomAction.updateMany({
                where: { id: action.id, roomId: room.id },
                data: values,
              })
            } else {
              await tx.crmDealRoomAction.create({
                data: { roomId: room.id, ...values },
              })
            }
          }
        }
        return room.id
      })
      const full = await prisma.crmDealRoom.findUniqueOrThrow({
        where: { id: roomId },
        include: roomInclude,
      })
      return ok(full)
    } catch (error) {
      return err(dbError('Failed to save CRM deal room', error))
    }
  },

  async listVisitors(roomId: string): Promise<Result<CrmDealRoomVisitor[]>> {
    try {
      return ok(
        await prisma.crmDealRoomVisitor.findMany({
          where: { roomId },
          orderBy: { lastSeenAt: 'desc' },
          take: 100,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM deal room visitors', error))
    }
  },

  async listEvents(
    roomId: string,
    limit: number,
  ): Promise<Result<CrmDealRoomEventWithVisitor[]>> {
    try {
      return ok(
        await prisma.crmDealRoomEvent.findMany({
          where: { roomId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { visitor: { select: { name: true, email: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM deal room events', error))
    }
  },

  async listMessages(
    roomId: string,
    limit: number,
  ): Promise<Result<CrmDealRoomMessage[]>> {
    try {
      const rows = await prisma.crmDealRoomMessage.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(rows.reverse())
    } catch (error) {
      return err(dbError('Failed to list CRM deal room messages', error))
    }
  },

  async createMessage(data: {
    roomId: string
    authorKind: CrmDealRoomAuthorKind
    authorUserId: string | null
    authorName: string
    visitorId: string | null
    body: string
  }): Promise<Result<CrmDealRoomMessage>> {
    try {
      return ok(await prisma.crmDealRoomMessage.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create CRM deal room message', error))
    }
  },

  /** Identifies (or re-identifies) a visitor by e-mail and bumps `lastSeenAt`. */
  async upsertVisitor(data: {
    roomId: string
    name: string
    email: string
    ipHash: string | null
  }): Promise<Result<CrmDealRoomVisitor>> {
    try {
      return ok(
        await prisma.crmDealRoomVisitor.upsert({
          where: { roomId_email: { roomId: data.roomId, email: data.email } },
          create: data,
          update: {
            name: data.name,
            ipHash: data.ipHash,
            lastSeenAt: new Date(),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save CRM deal room visitor', error))
    }
  },

  async findVisitor(
    roomId: string,
    visitorId: string,
  ): Promise<Result<CrmDealRoomVisitor | null>> {
    try {
      return ok(
        await prisma.crmDealRoomVisitor.findFirst({
          where: { id: visitorId, roomId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM deal room visitor', error))
    }
  },

  async createEvent(data: {
    roomId: string
    visitorId: string | null
    kind: CrmDealRoomEventKind
    targetId?: string | null
    targetLabel?: string | null
  }): Promise<Result<CrmDealRoomEvent>> {
    try {
      const event = await prisma.crmDealRoomEvent.create({ data })
      if (data.visitorId) {
        await prisma.crmDealRoomVisitor.updateMany({
          where: { id: data.visitorId, roomId: data.roomId },
          data: { lastSeenAt: new Date() },
        })
      }
      return ok(event)
    } catch (error) {
      return err(dbError('Failed to record CRM deal room event', error))
    }
  },

  /**
   * Checks or unchecks an action of the plan; `null` when the id is not an
   * action of the room (or not of `onlyOwner`, when given).
   */
  async setActionDone(
    roomId: string,
    actionId: string,
    done: boolean,
    label: string,
    now: Date,
    onlyOwner?: CrmDealRoomActionOwner,
  ): Promise<Result<{ id: string; title: string } | null>> {
    try {
      const action = await prisma.crmDealRoomAction.findFirst({
        where: { id: actionId, roomId, ...(onlyOwner && { owner: onlyOwner }) },
      })
      if (!action) return ok(null)
      await prisma.crmDealRoomAction.update({
        where: { id: actionId },
        data: done
          ? { doneAt: now, doneByLabel: label }
          : { doneAt: null, doneByLabel: null },
      })
      return ok({ id: action.id, title: action.title })
    } catch (error) {
      return err(dbError('Failed to update CRM deal room action', error))
    }
  },
}
