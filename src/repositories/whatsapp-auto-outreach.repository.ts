import type {
  Prisma,
  WhatsAppAutoOutreach,
  WhatsAppAutoOutreachRecipient,
  WhatsAppAutoOutreachRecipientStatus,
  WhatsAppContact,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type WhatsAppAutoOutreachRecipientCounts = Record<
  WhatsAppAutoOutreachRecipientStatus,
  number
>

export type WhatsAppAutoOutreachRecipientWithContact =
  WhatsAppAutoOutreachRecipient & { contact: WhatsAppContact }

export const WhatsAppAutoOutreachRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppAutoOutreach | null>> {
    try {
      const outreach = await prisma.whatsAppAutoOutreach.findUnique({
        where: { workspaceId },
      })
      return ok(outreach)
    } catch (error) {
      return err(dbError('Failed to find whatsapp auto outreach', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<Prisma.WhatsAppAutoOutreachUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<WhatsAppAutoOutreach>> {
    try {
      const outreach = await prisma.whatsAppAutoOutreach.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      })
      return ok(outreach)
    } catch (error) {
      return err(dbError('Failed to save whatsapp auto outreach', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppAutoOutreachUncheckedUpdateInput,
  ): Promise<Result<WhatsAppAutoOutreach>> {
    try {
      const outreach = await prisma.whatsAppAutoOutreach.update({
        where: { id },
        data,
      })
      return ok(outreach)
    } catch (error) {
      return err(dbError('Failed to update whatsapp auto outreach', error))
    }
  },

  /**
   * Stops the run only if it is still the one identified by `runToken` —
   * a play/pause in between wins over the worker's automatic stop.
   */
  async stopRun(
    id: string,
    runToken: string,
    data: Pick<
      Prisma.WhatsAppAutoOutreachUncheckedUpdateInput,
      'status' | 'lastError'
    >,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.whatsAppAutoOutreach.updateMany({
        where: { id, runToken, status: 'RUNNING' },
        data: { ...data, runToken: null },
      })
      return ok(updated.count > 0)
    } catch (error) {
      return err(dbError('Failed to stop whatsapp auto outreach', error))
    }
  },

  async countRecipients(
    outreachId: string,
  ): Promise<Result<WhatsAppAutoOutreachRecipientCounts>> {
    try {
      const groups = await prisma.whatsAppAutoOutreachRecipient.groupBy({
        by: ['status'],
        where: { outreachId },
        _count: { _all: true },
      })
      const counts: WhatsAppAutoOutreachRecipientCounts = {
        PENDING: 0,
        SENT: 0,
        FAILED: 0,
        SKIPPED: 0,
      }
      for (const group of groups) counts[group.status] = group._count._all
      return ok(counts)
    } catch (error) {
      return err(dbError('Failed to count whatsapp auto outreach queue', error))
    }
  },

  /** Workspace contacts (not opted out) among `contactIds`, or all of them. */
  async listQueueableContactIds(
    workspaceId: string,
    contactIds: string[] | null,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: {
          workspaceId,
          broadcastOptedOutAt: null,
          ...(contactIds ? { id: { in: contactIds } } : {}),
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      return ok(contacts.map((contact) => contact.id))
    } catch (error) {
      return err(dbError('Failed to list whatsapp contacts to queue', error))
    }
  },

  /** Queues the contacts; ones already in the queue (any status) stay. */
  async addRecipients(
    outreachId: string,
    contactIds: string[],
  ): Promise<Result<number>> {
    try {
      const created = await prisma.whatsAppAutoOutreachRecipient.createMany({
        data: contactIds.map((contactId) => ({ outreachId, contactId })),
        skipDuplicates: true,
      })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to queue whatsapp auto outreach', error))
    }
  },

  /** Clears the pending queue, or the whole history with `all`. */
  async clearRecipients(
    outreachId: string,
    all: boolean,
  ): Promise<Result<number>> {
    try {
      const deleted = await prisma.whatsAppAutoOutreachRecipient.deleteMany({
        where: { outreachId, ...(all ? {} : { status: 'PENDING' }) },
      })
      return ok(deleted.count)
    } catch (error) {
      return err(dbError('Failed to clear whatsapp auto outreach queue', error))
    }
  },

  async findNextPending(
    outreachId: string,
  ): Promise<Result<WhatsAppAutoOutreachRecipientWithContact | null>> {
    try {
      const recipient = await prisma.whatsAppAutoOutreachRecipient.findFirst({
        where: { outreachId, status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { contact: true },
      })
      return ok(recipient)
    } catch (error) {
      return err(
        dbError('Failed to find next whatsapp auto outreach recipient', error),
      )
    }
  },

  async updateRecipient(
    id: string,
    data: Prisma.WhatsAppAutoOutreachRecipientUncheckedUpdateInput,
  ): Promise<Result<WhatsAppAutoOutreachRecipient>> {
    try {
      const recipient = await prisma.whatsAppAutoOutreachRecipient.update({
        where: { id },
        data,
      })
      return ok(recipient)
    } catch (error) {
      return err(
        dbError('Failed to update whatsapp auto outreach recipient', error),
      )
    }
  },
}
