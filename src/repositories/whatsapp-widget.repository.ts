import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppWidgetSettings,
  WhatsAppWidgetVisitor,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import {
  WIDGET_CONNECTION_LABEL,
  WIDGET_CONNECTION_PHONE,
} from '@/src/lib/whatsapp/widget'
import { dbError } from './db-error'

export type WhatsAppWidgetSettingsInput = Omit<
  Prisma.WhatsAppWidgetSettingsUncheckedUpdateInput,
  'id' | 'workspaceId' | 'publicKey' | 'createdAt' | 'updatedAt'
>

export const WhatsAppWidgetSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppWidgetSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppWidgetSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp widget settings', error))
    }
  },

  async findByPublicKey(
    publicKey: string,
  ): Promise<Result<WhatsAppWidgetSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppWidgetSettings.findUnique({
          where: { publicKey },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to find whatsapp widget settings by key', error),
      )
    }
  },

  /** Creates the row with a fresh `publicKey` or updates the given fields. */
  async upsert(
    workspaceId: string,
    publicKey: string,
    data: WhatsAppWidgetSettingsInput,
  ): Promise<Result<WhatsAppWidgetSettings>> {
    try {
      return ok(
        await prisma.whatsAppWidgetSettings.upsert({
          where: { workspaceId },
          create: {
            workspaceId,
            publicKey,
            ...(data as Prisma.WhatsAppWidgetSettingsUncheckedCreateInput),
          },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp widget settings', error))
    }
  },

  async rotateKey(
    workspaceId: string,
    publicKey: string,
  ): Promise<Result<WhatsAppWidgetSettings>> {
    try {
      return ok(
        await prisma.whatsAppWidgetSettings.update({
          where: { workspaceId },
          data: { publicKey },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to rotate whatsapp widget key', error))
    }
  },

  /** The virtual WIDGET connection of the workspace (created once). */
  async ensureConnection(
    workspaceId: string,
    createdById: string,
  ): Promise<Result<WhatsAppConnection>> {
    try {
      return ok(
        await prisma.whatsAppConnection.upsert({
          where: {
            workspaceId_provider_phoneNumber: {
              workspaceId,
              provider: 'WIDGET',
              phoneNumber: WIDGET_CONNECTION_PHONE,
            },
          },
          create: {
            workspaceId,
            provider: 'WIDGET',
            module: 'COMMUNICATION',
            label: WIDGET_CONNECTION_LABEL,
            phoneNumber: WIDGET_CONNECTION_PHONE,
            status: 'CONNECTED',
            createdById,
          },
          update: { status: 'CONNECTED' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to ensure whatsapp widget connection', error))
    }
  },

  async findConnection(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      return ok(
        await prisma.whatsAppConnection.findFirst({
          where: { id, workspaceId, provider: 'WIDGET' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp widget connection', error))
    }
  },

  /** A team of the workspace, for the routing field. */
  async teamExists(
    workspaceId: string,
    teamId: string,
  ): Promise<Result<boolean>> {
    try {
      const team = await prisma.whatsAppTeam.findFirst({
        where: { id: teamId, workspaceId },
        select: { id: true },
      })
      return ok(team !== null)
    } catch (error) {
      return err(dbError('Failed to check whatsapp widget team', error))
    }
  },
}

export type WidgetVisitorCreate = {
  workspaceId: string
  contactId: string
  tokenHash: string
  name: string | null
  email: string | null
  phone: string | null
  origin: string | null
}

/** Latest message rows the widget shows (no internal columns). */
export type WidgetMessageRow = Pick<
  WhatsAppMessage,
  | 'id'
  | 'direction'
  | 'type'
  | 'text'
  | 'mediaUrl'
  | 'sentByAi'
  | 'senderUserId'
  | 'createdAt'
>

export const WhatsAppWidgetVisitorRepository = {
  async create(
    data: WidgetVisitorCreate,
  ): Promise<Result<WhatsAppWidgetVisitor>> {
    try {
      return ok(await prisma.whatsAppWidgetVisitor.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp widget visitor', error))
    }
  },

  async findByTokenHash(
    tokenHash: string,
  ): Promise<Result<WhatsAppWidgetVisitor | null>> {
    try {
      return ok(
        await prisma.whatsAppWidgetVisitor.findUnique({ where: { tokenHash } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp widget visitor', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppWidgetVisitorUncheckedUpdateInput,
  ): Promise<Result<WhatsAppWidgetVisitor>> {
    try {
      return ok(await prisma.whatsAppWidgetVisitor.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update whatsapp widget visitor', error))
    }
  },

  /** Free text on the contact card ("about"): identification from the pre-chat. */
  async setContactDescription(
    contactId: string,
    description: string,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppContact.update({
        where: { id: contactId },
        data: { description },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to set widget contact description', error))
    }
  },

  /** The visitor's conversation on the widget connection (newest first). */
  async findConversation(
    workspaceId: string,
    contactId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppConversation | null>> {
    try {
      return ok(
        await prisma.whatsAppConversation.findFirst({
          where: { workspaceId, contactId, connectionId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp widget conversation', error))
    }
  },

  async listMessages(
    conversationId: string,
    after: Date | null,
    limit: number,
  ): Promise<Result<WidgetMessageRow[]>> {
    try {
      const rows = await prisma.whatsAppMessage.findMany({
        where: {
          conversationId,
          deletedAt: null,
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: { createdAt: after ? 'asc' : 'desc' },
        take: limit,
        select: {
          id: true,
          direction: true,
          type: true,
          text: true,
          mediaUrl: true,
          sentByAi: true,
          senderUserId: true,
          createdAt: true,
        },
      })
      // First load takes the newest page; show it oldest first.
      return ok(after ? rows : rows.reverse())
    } catch (error) {
      return err(dbError('Failed to list whatsapp widget messages', error))
    }
  },

  /** Was this exact outbound text already sent on the conversation since `since`? */
  async hasOutboundText(
    conversationId: string,
    text: string,
    since: Date,
  ): Promise<Result<boolean>> {
    try {
      const found = await prisma.whatsAppMessage.findFirst({
        where: {
          conversationId,
          direction: 'OUT',
          text,
          createdAt: { gte: since },
        },
        select: { id: true },
      })
      return ok(found !== null)
    } catch (error) {
      return err(dbError('Failed to check widget offline notice', error))
    }
  },
}
