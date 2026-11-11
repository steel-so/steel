import type { DocumentEvent, DocumentEventType, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { type DocumentPersonRef, documentCreators } from './document.repository'

export type DocumentEventRow = DocumentEvent & {
  recipient: DocumentPersonRef | null
  actor: DocumentPersonRef | null
}

export interface NewDocumentEvent {
  documentId: string
  workspaceId: string
  type: DocumentEventType
  recipientId?: string | null
  actorId?: string | null
  data?: Prisma.InputJsonValue
}

/** The timeline shows at most this many events, newest first. */
const TIMELINE_LIMIT = 500

export const DocumentEventRepository = {
  async createMany(events: NewDocumentEvent[]): Promise<Result<number>> {
    if (events.length === 0) return ok(0)
    try {
      const { count } = await prisma.documentEvent.createMany({
        data: events.map((event) => ({
          documentId: event.documentId,
          workspaceId: event.workspaceId,
          type: event.type,
          recipientId: event.recipientId ?? null,
          actorId: event.actorId ?? null,
          data: event.data ?? {},
        })),
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to create document events', error))
    }
  },

  async listByDocument(
    documentId: string,
  ): Promise<Result<DocumentEventRow[]>> {
    try {
      const rows = await prisma.documentEvent.findMany({
        where: { documentId },
        include: { recipient: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TIMELINE_LIMIT,
      })
      const actors = await documentCreators(rows.map((row) => row.actorId))
      return ok(
        rows.map((row) => ({
          ...row,
          actor: actors.get(row.actorId ?? '') ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list document events', error))
    }
  },
}
