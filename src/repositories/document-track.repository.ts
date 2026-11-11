import {
  type DocumentEventType,
  type DocumentKind,
  type DocumentStatus,
  Prisma,
} from '@prisma/client'
import type {
  DocumentReadBatch,
  DocumentSectionDelta,
} from '@/src/cache/document-analytics.cache'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Writes of the document reading analytics (ADR 0063): the public link
 * opens sessions and logs events here; the `documents-analytics` worker
 * applies the Redis buffer. View timestamps are written with raw SQL on
 * purpose: they must not bump `documents.updated_at`, which the editor's
 * autosave uses to detect conflicting saves.
 */

/** A public link token (recipient token or document `publicToken`). */
export interface DocumentLinkRow {
  documentId: string
  workspaceId: string
  recipientId: string | null
  versionId: string | null
  isTemplate: boolean
  linkEnabled: boolean
  status: DocumentStatus
  deleted: boolean
}

export interface DocumentTrackContext {
  document: {
    id: string
    workspaceId: string
    title: string
    kind: DocumentKind
    /** Before this session marked it: `null` = first view ever. */
    firstViewedAt: Date | null
    ownerId: string
    settings: Prisma.JsonValue
    owner: { id: string; name: string; email: string }
    workspace: { slug: string; name: string }
  }
  recipient: {
    id: string
    name: string
    firstViewedAt: Date | null
  } | null
}

export interface OpenDocumentSessionInput {
  documentId: string
  workspaceId: string
  versionId: string | null
  recipientId: string | null
  sessionKey: string
  visitorId: string
  ipHash: string
  userAgent: string | null
  device: string | null
  referrer: string | null
  at: Date
}

export interface DocumentEventInput {
  documentId: string
  workspaceId: string
  type: DocumentEventType
  sessionId: string | null
  recipientId: string | null
  data: Prisma.InputJsonValue
}

const LINK_SELECT = {
  id: true,
  workspaceId: true,
  currentVersionId: true,
  isTemplate: true,
  linkEnabled: true,
  status: true,
  deletedAt: true,
} as const

type LinkDocument = Prisma.DocumentGetPayload<{ select: typeof LINK_SELECT }>

function toLinkRow(
  document: LinkDocument,
  recipientId: string | null,
): DocumentLinkRow {
  return {
    documentId: document.id,
    workspaceId: document.workspaceId,
    recipientId,
    versionId: document.currentVersionId,
    isTemplate: document.isTemplate,
    linkEnabled: document.linkEnabled,
    status: document.status,
    deleted: document.deletedAt !== null,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

function sectionUpsert(delta: DocumentSectionDelta, documentId: string) {
  const firstSeenAt = delta.firstSeenAt ?? new Date()
  return prisma.documentSectionStat.upsert({
    where: {
      sessionId_sectionId: {
        sessionId: delta.sessionId,
        sectionId: delta.sectionId,
      },
    },
    create: {
      sessionId: delta.sessionId,
      documentId,
      sectionId: delta.sectionId,
      activeMs: delta.activeMs,
      views: delta.views,
      firstSeenAt,
    },
    update: {
      activeMs: { increment: delta.activeMs },
      views: { increment: delta.views },
    },
  })
}

export const DocumentTrackRepository = {
  /** Resolves a recipient token first, then a document `publicToken`. */
  async findLink(token: string): Promise<Result<DocumentLinkRow | null>> {
    try {
      const recipient = await prisma.documentRecipient.findUnique({
        where: { token },
        select: { id: true, document: { select: LINK_SELECT } },
      })
      if (recipient) return ok(toLinkRow(recipient.document, recipient.id))

      const document = await prisma.document.findUnique({
        where: { publicToken: token },
        select: LINK_SELECT,
      })
      return ok(document ? toLinkRow(document, null) : null)
    } catch (error) {
      return err(dbError('Failed to resolve the document link', error))
    }
  },

  async findContext(
    documentId: string,
    recipientId: string | null,
  ): Promise<Result<DocumentTrackContext | null>> {
    try {
      const [document, recipient] = await Promise.all([
        prisma.document.findUnique({
          where: { id: documentId },
          select: {
            id: true,
            workspaceId: true,
            title: true,
            kind: true,
            firstViewedAt: true,
            ownerId: true,
            settings: true,
            owner: { select: { id: true, name: true, email: true } },
            workspace: { select: { slug: true, name: true } },
          },
        }),
        recipientId
          ? prisma.documentRecipient.findFirst({
              where: { id: recipientId, documentId },
              select: { id: true, name: true, firstViewedAt: true },
            })
          : Promise.resolve(null),
      ])
      if (!document) return ok(null)
      return ok({ document, recipient })
    } catch (error) {
      return err(dbError('Failed to load the document track context', error))
    }
  },

  /** Creates the session or returns the one already open for the key. */
  async openSession(
    input: OpenDocumentSessionInput,
  ): Promise<Result<{ id: string; created: boolean }>> {
    try {
      const session = await prisma.documentSession.create({
        data: {
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          versionId: input.versionId,
          recipientId: input.recipientId,
          sessionKey: input.sessionKey,
          visitorId: input.visitorId,
          ipHash: input.ipHash,
          userAgent: input.userAgent,
          device: input.device,
          referrer: input.referrer,
          startedAt: input.at,
          lastSeenAt: input.at,
        },
        select: { id: true },
      })
      return ok({ id: session.id, created: true })
    } catch (error) {
      if (!isUniqueViolation(error)) {
        return err(dbError('Failed to open the document session', error))
      }
    }
    try {
      const existing = await prisma.documentSession.findUnique({
        where: {
          documentId_sessionKey: {
            documentId: input.documentId,
            sessionKey: input.sessionKey,
          },
        },
        select: { id: true },
      })
      if (!existing) {
        return err(dbError('Document session vanished after a conflict', null))
      }
      return ok({ id: existing.id, created: false })
    } catch (error) {
      return err(dbError('Failed to load the document session', error))
    }
  },

  /**
   * First/last view timestamps and the SENT → VIEWED (document) and
   * PENDING → VIEWED (recipient) transitions, without touching
   * `documents.updated_at`.
   */
  async markViewed(input: {
    documentId: string
    recipientId: string | null
    at: Date
  }): Promise<Result<void>> {
    const { documentId, recipientId, at } = input
    try {
      const writes = [
        prisma.$executeRaw`
          UPDATE documents SET
            first_viewed_at = COALESCE(first_viewed_at, ${at}::timestamp),
            last_viewed_at = GREATEST(last_viewed_at, ${at}::timestamp),
            status = CASE WHEN status = 'SENT'
              THEN 'VIEWED'::"DocumentStatus" ELSE status END
          WHERE id = ${documentId}`,
      ]
      if (recipientId) {
        writes.push(prisma.$executeRaw`
          UPDATE document_recipients SET
            first_viewed_at = COALESCE(first_viewed_at, ${at}::timestamp),
            last_viewed_at = GREATEST(last_viewed_at, ${at}::timestamp),
            status = CASE WHEN status = 'PENDING'
              THEN 'VIEWED'::"DocumentRecipientStatus" ELSE status END
          WHERE id = ${recipientId}`)
      }
      await prisma.$transaction(writes)
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark the document as viewed', error))
    }
  },

  /**
   * Who else read this personal link before the given session: whether
   * this visitor already had a session there, and whether someone else did.
   */
  async visitorHistory(input: {
    recipientId: string
    visitorId: string
    sessionId: string
  }): Promise<Result<{ sameVisitor: boolean; otherVisitor: boolean }>> {
    try {
      const [same, other] = await Promise.all([
        prisma.documentSession.findFirst({
          where: {
            recipientId: input.recipientId,
            visitorId: input.visitorId,
            id: { not: input.sessionId },
          },
          select: { id: true },
        }),
        prisma.documentSession.findFirst({
          where: {
            recipientId: input.recipientId,
            visitorId: { not: input.visitorId },
          },
          select: { id: true },
        }),
      ])
      return ok({ sameVisitor: same !== null, otherVisitor: other !== null })
    } catch (error) {
      return err(dbError('Failed to read the link visitor history', error))
    }
  },

  async createEvents(events: DocumentEventInput[]): Promise<Result<number>> {
    if (events.length === 0) return ok(0)
    try {
      const created = await prisma.documentEvent.createMany({ data: events })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to record document events', error))
    }
  },

  /**
   * Applies a flushed buffer in one transaction: increments of active time
   * and views, greatest scroll and last-seen, reached-end. Sessions that no
   * longer exist (document deleted) are skipped.
   */
  async applyReadBatch(
    batch: DocumentReadBatch,
    now: Date = new Date(),
  ): Promise<Result<{ sessions: number; sections: number }>> {
    const ids = [...new Set(batch.sessions.map((s) => s.sessionId))]
    if (ids.length === 0) return ok({ sessions: 0, sections: 0 })
    try {
      const existing = await prisma.documentSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, documentId: true },
      })
      const documentOf = new Map(existing.map((s) => [s.id, s.documentId]))

      const sessions = batch.sessions.filter((s) =>
        documentOf.has(s.sessionId),
      )
      const sections = batch.sections.filter(
        (s) => documentOf.has(s.sessionId) && (s.activeMs > 0 || s.views > 0),
      )
      if (sessions.length === 0) return ok({ sessions: 0, sections: 0 })

      await prisma.$transaction([
        ...sessions.map(
          (s) => prisma.$executeRaw`
            UPDATE document_sessions SET
              active_ms = active_ms + ${s.activeMs}::int,
              max_scroll_pct = GREATEST(max_scroll_pct, ${s.maxScrollPct}::int),
              reached_end = reached_end OR ${s.reachedEnd}::boolean,
              last_seen_at = GREATEST(
                last_seen_at,
                ${s.lastSeenAt ?? now}::timestamp
              ),
              updated_at = ${now}::timestamp
            WHERE id = ${s.sessionId}`,
        ),
        ...sections.map((s) =>
          sectionUpsert(s, documentOf.get(s.sessionId) as string),
        ),
      ])
      return ok({ sessions: sessions.length, sections: sections.length })
    } catch (error) {
      return err(dbError('Failed to apply the document reading batch', error))
    }
  },
}
