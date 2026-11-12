import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppContactBlock,
  WhatsAppContactBlockOrigin,
  WhatsAppContactBlockStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const blockInclude = {
  connection: {
    select: { id: true, label: true, phoneNumber: true, provider: true },
  },
  contact: { select: { id: true, name: true } },
} satisfies Prisma.WhatsAppContactBlockInclude

export type WhatsAppContactBlockWithRefs = Prisma.WhatsAppContactBlockGetPayload<{
  include: typeof blockInclude
}>

export interface CreateContactBlockInput {
  workspaceId: string
  connectionId: string
  contactId: string | null
  waId: string
  reason: string | null
  blockedById: string | null
  origin: WhatsAppContactBlockOrigin
  providerStatus: WhatsAppContactBlockStatus
  providerError: string | null
  at: Date
}

export interface ContactBlockProviderUpdate {
  providerStatus: WhatsAppContactBlockStatus
  providerError: string | null
  at: Date
}

/** Comunicação phone lines: the only ones a contact can be blocked on. */
const BLOCKABLE_LINE = {
  module: 'COMMUNICATION',
  provider: { in: ['META', 'ZAPI'] },
} as const satisfies Prisma.WhatsAppConnectionWhereInput

/**
 * Contacts blocked on a WhatsApp number (zap-block-contacts). Pure Prisma:
 * the provider calls and the permission rules live in the service.
 */
export const WhatsAppContactBlockRepository = {
  /** Hot path (every inbound and outbound message): one indexed lookup. */
  async findActive(
    connectionId: string,
    waIds: string[],
  ): Promise<Result<WhatsAppContactBlock | null>> {
    if (waIds.length === 0) return ok(null)
    try {
      const row = await prisma.whatsAppContactBlock.findFirst({
        where: { connectionId, waId: { in: waIds } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contact block', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppContactBlockWithRefs | null>> {
    try {
      const row = await prisma.whatsAppContactBlock.findFirst({
        where: { id, workspaceId },
        include: blockInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contact block', error))
    }
  },

  async findWithRefs(
    connectionId: string,
    waIds: string[],
  ): Promise<Result<WhatsAppContactBlockWithRefs | null>> {
    if (waIds.length === 0) return ok(null)
    try {
      const row = await prisma.whatsAppContactBlock.findFirst({
        where: { connectionId, waId: { in: waIds } },
        include: blockInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contact block', error))
    }
  },

  async listByWorkspace(
    workspaceId: string,
    connectionId?: string,
  ): Promise<Result<WhatsAppContactBlockWithRefs[]>> {
    try {
      const rows = await prisma.whatsAppContactBlock.findMany({
        where: { workspaceId, ...(connectionId ? { connectionId } : {}) },
        include: blockInclude,
        orderBy: { blockedAt: 'desc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list whatsapp contact blocks', error))
    }
  },

  /** Contacts (of the given ids) blocked on at least one number. */
  async listBlockedContactIds(
    workspaceId: string,
    contactIds: string[],
  ): Promise<Result<Set<string>>> {
    if (contactIds.length === 0) return ok(new Set())
    try {
      const rows = await prisma.whatsAppContactBlock.findMany({
        where: { workspaceId, contactId: { in: contactIds } },
        select: { contactId: true },
        distinct: ['contactId'],
      })
      return ok(
        new Set(
          rows
            .map((row) => row.contactId)
            .filter((id): id is string => id !== null),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to list blocked whatsapp contacts', error))
    }
  },

  /** Waiting or refused at the provider: what a sync sends again. */
  async listUnapplied(
    connectionId: string,
  ): Promise<Result<WhatsAppContactBlock[]>> {
    try {
      const rows = await prisma.whatsAppContactBlock.findMany({
        where: { connectionId, providerStatus: { in: ['PENDING', 'FAILED'] } },
        orderBy: { blockedAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list unapplied contact blocks', error))
    }
  },

  async listWaIds(connectionId: string): Promise<Result<Set<string>>> {
    try {
      const rows = await prisma.whatsAppContactBlock.findMany({
        where: { connectionId },
        select: { waId: true },
      })
      return ok(new Set(rows.map((row) => row.waId)))
    } catch (error) {
      return err(dbError('Failed to list contact block wa_ids', error))
    }
  },

  async create(
    input: CreateContactBlockInput,
  ): Promise<Result<WhatsAppContactBlockWithRefs>> {
    try {
      const row = await prisma.whatsAppContactBlock.create({
        data: {
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          contactId: input.contactId,
          waId: input.waId,
          reason: input.reason,
          blockedById: input.blockedById,
          origin: input.origin,
          providerStatus: input.providerStatus,
          providerError: input.providerError,
          lastAttemptAt: input.origin === 'STEEL' ? input.at : null,
          appliedAt: input.providerStatus === 'APPLIED' ? input.at : null,
          blockedAt: input.at,
        },
        include: blockInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create whatsapp contact block', error))
    }
  },

  /** Imports provider blocks; a number already blocked is left untouched. */
  async createMany(inputs: CreateContactBlockInput[]): Promise<Result<number>> {
    if (inputs.length === 0) return ok(0)
    try {
      const result = await prisma.whatsAppContactBlock.createMany({
        data: inputs.map((input) => ({
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          contactId: input.contactId,
          waId: input.waId,
          reason: input.reason,
          blockedById: input.blockedById,
          origin: input.origin,
          providerStatus: input.providerStatus,
          providerError: input.providerError,
          appliedAt: input.providerStatus === 'APPLIED' ? input.at : null,
          blockedAt: input.at,
        })),
        skipDuplicates: true,
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to import whatsapp contact blocks', error))
    }
  },

  async updateProviderStatus(
    id: string,
    update: ContactBlockProviderUpdate,
  ): Promise<Result<WhatsAppContactBlockWithRefs>> {
    try {
      const row = await prisma.whatsAppContactBlock.update({
        where: { id },
        data: {
          providerStatus: update.providerStatus,
          providerError: update.providerError,
          lastAttemptAt: update.at,
          ...(update.providerStatus === 'APPLIED'
            ? { appliedAt: update.at }
            : {}),
        },
        include: blockInclude,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update whatsapp contact block', error))
    }
  },

  /** One more inbound message ignored because of the block. */
  async recordDropped(id: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.whatsAppContactBlock.update({
        where: { id },
        data: { droppedCount: { increment: 1 }, lastDroppedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to count a dropped whatsapp message', error))
    }
  },

  async delete(id: string, workspaceId: string): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppContactBlock.deleteMany({
        where: { id, workspaceId },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp contact block', error))
    }
  },

  /** Phone lines of the workspace a block can live on. */
  async listBlockableConnections(
    workspaceId: string,
    connectionId?: string,
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: {
          workspaceId,
          ...BLOCKABLE_LINE,
          ...(connectionId ? { id: connectionId } : {}),
        },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list blockable whatsapp lines', error))
    }
  },

  /** Display names of the members who blocked (`id -> name`). */
  async findUserNames(ids: string[]): Promise<Result<Map<string, string>>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return ok(new Map())
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true, email: true },
      })
      return ok(
        new Map(users.map((user) => [user.id, user.name || user.email])),
      )
    } catch (error) {
      return err(dbError('Failed to find blocker names', error))
    }
  },
}
