import type {
  WhatsAppArchive,
  WhatsAppArchiveKind,
  WhatsAppArchiveSettings,
  WhatsAppMessageDirection,
  WhatsAppMessageType,
} from '@prisma/client'
import { whatsappArchiveNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * WhatsApp archive for banks (ADR 0052): per-workspace settings, the
 * package records and the read side the worker streams from (conversations
 * with messages in a period, then each conversation's messages page by
 * page). No business rules here.
 */

export type WhatsAppArchiveWithTrigger = WhatsAppArchive & {
  triggeredBy: { id: string; name: string; email: string } | null
}

export interface ArchiveRange {
  /** Inclusive; `null` = no lower bound. */
  start: Date | null
  /** Inclusive. */
  end: Date
}

export interface ArchiveConversationRow {
  id: string
  connection: { label: string; phoneNumber: string }
  contact: { name: string | null; waId: string }
  assignedUser: { id: string; name: string } | null
}

export interface ArchiveMessageRow {
  id: string
  direction: WhatsAppMessageDirection
  type: WhatsAppMessageType
  text: string | null
  mediaUrl: string | null
  sentByAi: boolean
  senderUserId: string | null
  senderUser: { name: string } | null
  deletedAt: Date | null
  createdAt: Date
}

export interface EnabledArchiveWorkspace {
  workspaceId: string
}

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'] as const

const withTrigger = {
  triggeredBy: { select: { id: true, name: true, email: true } },
} as const

function createdAtIn(range: ArchiveRange) {
  return { ...(range.start ? { gte: range.start } : {}), lte: range.end }
}

export const WhatsAppArchiveRepository = {
  async getSettings(
    workspaceId: string,
  ): Promise<Result<WhatsAppArchiveSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppArchiveSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to read WhatsApp archive settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: {
      enabled?: boolean
      rootFolderName?: string | null
      updatedById: string
    },
  ): Promise<Result<WhatsAppArchiveSettings>> {
    try {
      return ok(
        await prisma.whatsAppArchiveSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save WhatsApp archive settings', error))
    }
  },

  async listEnabledWorkspaces(): Promise<Result<EnabledArchiveWorkspace[]>> {
    try {
      return ok(
        await prisma.whatsAppArchiveSettings.findMany({
          where: { enabled: true, workspace: { status: 'ACTIVE' } },
          select: { workspaceId: true },
          orderBy: { workspaceId: 'asc' },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to list workspaces with the WhatsApp archive', error),
      )
    }
  },

  async listByWorkspace(
    workspaceId: string,
    limit = 50,
  ): Promise<Result<WhatsAppArchiveWithTrigger[]>> {
    try {
      return ok(
        await prisma.whatsAppArchive.findMany({
          where: { workspaceId },
          include: withTrigger,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list WhatsApp archives', error))
    }
  },

  /** Without `workspaceId` (worker), any workspace. */
  async findById(
    id: string,
    workspaceId?: string,
  ): Promise<Result<WhatsAppArchiveWithTrigger>> {
    try {
      const row = await prisma.whatsAppArchive.findFirst({
        where: { id, ...(workspaceId ? { workspaceId } : {}) },
        include: withTrigger,
      })
      if (!row) return err(whatsappArchiveNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find WhatsApp archive', error))
    }
  },

  /** A package of this kind still queued or being built. */
  async findActive(
    workspaceId: string,
    kind: WhatsAppArchiveKind,
  ): Promise<Result<WhatsAppArchive | null>> {
    try {
      return ok(
        await prisma.whatsAppArchive.findFirst({
          where: { workspaceId, kind, status: { in: [...ACTIVE_STATUSES] } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find an active WhatsApp archive', error))
    }
  },

  /** A non-failed package that already covers this exact period. */
  async findForPeriod(
    workspaceId: string,
    kind: WhatsAppArchiveKind,
    periodEnd: Date,
  ): Promise<Result<WhatsAppArchive | null>> {
    try {
      return ok(
        await prisma.whatsAppArchive.findFirst({
          where: { workspaceId, kind, periodEnd, status: { not: 'FAILED' } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find the WhatsApp archive period', error))
    }
  },

  async create(data: {
    workspaceId: string
    kind: WhatsAppArchiveKind
    periodStart: Date | null
    periodEnd: Date
    triggeredById: string | null
  }): Promise<Result<WhatsAppArchiveWithTrigger>> {
    try {
      return ok(
        await prisma.whatsAppArchive.create({ data, include: withTrigger }),
      )
    } catch (error) {
      return err(dbError('Failed to create WhatsApp archive', error))
    }
  },

  async markRunning(
    id: string,
    rootFolderName: string,
    startedAt: Date,
  ): Promise<Result<WhatsAppArchive>> {
    try {
      return ok(
        await prisma.whatsAppArchive.update({
          where: { id },
          data: { status: 'RUNNING', rootFolderName, startedAt, error: null },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to mark WhatsApp archive running', error))
    }
  },

  async markDone(
    id: string,
    data: {
      objectKey: string
      sizeBytes: number
      sha256: string
      fileCount: number
      atendimentoCount: number
      completedAt: Date
      expiresAt: Date
    },
  ): Promise<Result<WhatsAppArchive>> {
    try {
      return ok(
        await prisma.whatsAppArchive.update({
          where: { id },
          data: {
            ...data,
            sizeBytes: BigInt(data.sizeBytes),
            status: 'DONE',
            error: null,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to mark WhatsApp archive done', error))
    }
  },

  async markFailed(id: string, message: string): Promise<Result<true>> {
    try {
      await prisma.whatsAppArchive.update({
        where: { id },
        data: {
          status: 'FAILED',
          error: message.slice(0, 1000),
          completedAt: new Date(),
        },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to mark WhatsApp archive failed', error))
    }
  },

  async markOffsiteCopied(
    id: string,
    offsiteKey: string,
    copiedAt: Date,
  ): Promise<Result<true>> {
    try {
      await prisma.whatsAppArchive.update({
        where: { id },
        data: { offsiteKey, offsiteCopiedAt: copiedAt },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to record the off-site copy', error))
    }
  },

  /** Finished packages past their retention that still hold a file. */
  async listExpired(now: Date): Promise<Result<WhatsAppArchive[]>> {
    try {
      return ok(
        await prisma.whatsAppArchive.findMany({
          where: {
            status: 'DONE',
            expiresAt: { lt: now },
            OR: [{ objectKey: { not: null } }, { offsiteKey: { not: null } }],
          },
          orderBy: { expiresAt: 'asc' },
          take: 500,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list expired WhatsApp archives', error))
    }
  },

  /** Keeps the row (history) but forgets the deleted files. */
  async markExpired(ids: string[]): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const result = await prisma.whatsAppArchive.updateMany({
        where: { id: { in: ids } },
        data: { objectKey: null, offsiteKey: null },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to mark WhatsApp archives expired', error))
    }
  },

  /**
   * Rows that own an object (or will, while queued/running): the orphan
   * sweep keeps their keys.
   */
  async listLiveObjects(): Promise<
    Result<{ id: string; workspaceId: string; objectKey: string | null }[]>
  > {
    try {
      return ok(
        await prisma.whatsAppArchive.findMany({
          where: {
            OR: [
              { objectKey: { not: null } },
              { status: { in: [...ACTIVE_STATUSES] } },
            ],
          },
          select: { id: true, workspaceId: true, objectKey: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list WhatsApp archive keys', error))
    }
  },

  /** Conversations with at least one message in the range, by id. */
  async listConversationBatch(
    workspaceId: string,
    range: ArchiveRange,
    afterId: string | null,
    take: number,
  ): Promise<Result<ArchiveConversationRow[]>> {
    try {
      return ok(
        await prisma.whatsAppConversation.findMany({
          where: {
            workspaceId,
            messages: { some: { createdAt: createdAtIn(range) } },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: {
            id: true,
            connection: { select: { label: true, phoneNumber: true } },
            contact: { select: { name: true, waId: true } },
            assignedUser: { select: { id: true, name: true } },
          },
          orderBy: { id: 'asc' },
          take,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list conversations to archive', error))
    }
  },

  /** One page of a conversation's messages in the range, oldest first. */
  async listMessagePage(
    conversationId: string,
    range: ArchiveRange,
    after: { createdAt: Date; id: string } | null,
    take: number,
  ): Promise<Result<ArchiveMessageRow[]>> {
    try {
      return ok(
        await prisma.whatsAppMessage.findMany({
          where: {
            conversationId,
            createdAt: createdAtIn(range),
            ...(after
              ? {
                  OR: [
                    { createdAt: { gt: after.createdAt } },
                    { createdAt: after.createdAt, id: { gt: after.id } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            direction: true,
            type: true,
            text: true,
            mediaUrl: true,
            sentByAi: true,
            senderUserId: true,
            senderUser: { select: { name: true } },
            deletedAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list messages to archive', error))
    }
  },
}
