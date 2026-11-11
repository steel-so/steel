import type { DocumentDeliveryChannel, DocumentRecipient } from '@prisma/client'
import { documentRecipientNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import type { NewDocumentRecipient } from './document-version.repository'

export const DocumentRecipientRepository = {
  async listByDocument(
    documentId: string,
  ): Promise<Result<DocumentRecipient[]>> {
    try {
      const rows = await prisma.documentRecipient.findMany({
        where: { documentId },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list document recipients', error))
    }
  },

  async findById(
    id: string,
    documentId: string,
  ): Promise<Result<DocumentRecipient>> {
    try {
      const row = await prisma.documentRecipient.findFirst({
        where: { id, documentId },
      })
      if (!row) return err(documentRecipientNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document recipient', error))
    }
  },

  async findByToken(token: string): Promise<Result<DocumentRecipient | null>> {
    try {
      const row = await prisma.documentRecipient.findUnique({
        where: { token },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document recipient by token', error))
    }
  },

  /** Reader identified on the generic link (never one the owner added). */
  async findIdentified(
    documentId: string,
    email: string,
  ): Promise<Result<DocumentRecipient | null>> {
    try {
      const row = await prisma.documentRecipient.findFirst({
        where: {
          documentId,
          email: { equals: email, mode: 'insensitive' },
          channel: 'LINK',
          sentAt: null,
        },
        orderBy: { createdAt: 'asc' },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find identified reader', error))
    }
  },

  async createMany(
    documentId: string,
    workspaceId: string,
    rows: NewDocumentRecipient[],
  ): Promise<Result<DocumentRecipient[]>> {
    try {
      const created = await prisma.documentRecipient.createManyAndReturn({
        data: rows.map((row) => ({ ...row, documentId, workspaceId })),
      })
      return ok(created)
    } catch (error) {
      return err(dbError('Failed to create document recipients', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.documentRecipient.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete document recipient', error))
    }
  },

  /** Delivery done: the send date and the channel that actually worked. */
  async markSent(
    id: string,
    data: { at: Date; channel: DocumentDeliveryChannel },
  ): Promise<Result<DocumentRecipient>> {
    try {
      const row = await prisma.documentRecipient.update({
        where: { id },
        data: { sentAt: data.at, channel: data.channel },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to mark document recipient as sent', error))
    }
  },

  /** First/last read of a personal link (PENDING → VIEWED). */
  async markViewed(id: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.documentRecipient.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'VIEWED' },
        }),
        prisma.documentRecipient.updateMany({
          where: { id, firstViewedAt: null },
          data: { firstViewedAt: at },
        }),
        prisma.documentRecipient.updateMany({
          where: { id },
          data: { lastViewedAt: at },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark document recipient as viewed', error))
    }
  },
}
