import type { DocumentExport, Prisma } from '@prisma/client'
import {
  documentExportNotFound,
  documentNotFound,
  documentVersionNotFound,
} from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * PDF exports of CRM > Documentos (ADR 0063): `document_exports` plus the
 * few document/version reads the export needs. Pure data access; the rules
 * (authz, reuse, download permission) live in `DocumentExportService`.
 */

export type DocumentExportRow = DocumentExport & {
  version: { number: number } | null
}

const WITH_VERSION = { version: { select: { number: true } } } as const

export interface ExportableDocument {
  id: string
  workspaceId: string
  title: string
  currentVersionId: string | null
  settings: Prisma.JsonValue
  updatedAt: Date
}

export interface ExportVersionTarget {
  document: {
    id: string
    workspaceId: string
    title: string
    settings: Prisma.JsonValue
  }
  version: { id: string; number: number; settings: Prisma.JsonValue }
}

interface RenderSource {
  content: Prisma.JsonValue
  theme: Prisma.JsonValue
  settings: Prisma.JsonValue
}

/** Everything the worker needs to print one export. */
export type ExportRenderJob = DocumentExport & {
  document: RenderSource & {
    title: string
    validUntil: Date | null
    workspace: { name: string; logoUrl: string | null }
  }
  version: (RenderSource & { number: number }) | null
}

export interface ReusableExportQuery {
  documentId: string
  versionId: string | null
  recipientId: string | null
  now: Date
  /** READY exports created before this are ignored (edited draft). */
  readySince?: Date
  /** PENDING/RUNNING exports created before this are considered dead. */
  inFlightSince: Date
}

export interface PrunableExport {
  id: string
  storageKey: string | null
}

export const DocumentExportRepository = {
  async findDocument(
    documentId: string,
    workspaceId: string,
  ): Promise<Result<ExportableDocument>> {
    try {
      const document = await prisma.document.findFirst({
        where: { id: documentId, workspaceId, deletedAt: null },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          currentVersionId: true,
          settings: true,
          updatedAt: true,
        },
      })
      if (!document) return err(documentNotFound())
      return ok(document)
    } catch (error) {
      return err(dbError('Failed to find document for export', error))
    }
  },

  async findVersionTarget(
    documentId: string,
    versionId: string,
  ): Promise<Result<ExportVersionTarget>> {
    try {
      const version = await prisma.documentVersion.findFirst({
        where: { id: versionId, documentId },
        select: {
          id: true,
          number: true,
          settings: true,
          document: {
            select: {
              id: true,
              workspaceId: true,
              title: true,
              settings: true,
              deletedAt: true,
            },
          },
        },
      })
      if (!version) return err(documentVersionNotFound())
      const { deletedAt, ...document } = version.document
      if (deletedAt) return err(documentNotFound())
      return ok({
        document,
        version: {
          id: version.id,
          number: version.number,
          settings: version.settings,
        },
      })
    } catch (error) {
      return err(dbError('Failed to find document version for export', error))
    }
  },

  /** A READY (not expired) or recent in-flight export of the same target. */
  async findReusable(
    query: ReusableExportQuery,
  ): Promise<Result<DocumentExportRow | null>> {
    try {
      const row = await prisma.documentExport.findFirst({
        where: {
          documentId: query.documentId,
          versionId: query.versionId,
          recipientId: query.recipientId,
          OR: [
            {
              status: 'READY',
              expiresAt: { gt: query.now },
              ...(query.readySince && {
                createdAt: { gt: query.readySince },
              }),
            },
            {
              status: { in: ['PENDING', 'RUNNING'] },
              createdAt: { gt: query.inFlightSince },
            },
          ],
        },
        // Enum order is PENDING, RUNNING, READY, FAILED: READY wins.
        orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
        include: WITH_VERSION,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find a reusable document export', error))
    }
  },

  async create(data: {
    documentId: string
    workspaceId: string
    versionId: string | null
    recipientId: string | null
    requestedById: string | null
  }): Promise<Result<DocumentExportRow>> {
    try {
      const row = await prisma.documentExport.create({
        data,
        include: WITH_VERSION,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create document export', error))
    }
  },

  async findById(
    id: string,
    scope: { documentId: string; workspaceId: string },
  ): Promise<Result<DocumentExportRow>> {
    try {
      const row = await prisma.documentExport.findFirst({
        where: {
          id,
          documentId: scope.documentId,
          workspaceId: scope.workspaceId,
        },
        include: WITH_VERSION,
      })
      if (!row) return err(documentExportNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document export', error))
    }
  },

  async findRenderJob(id: string): Promise<Result<ExportRenderJob | null>> {
    const source = { content: true, theme: true, settings: true } as const
    try {
      const row = await prisma.documentExport.findUnique({
        where: { id },
        include: {
          document: {
            select: {
              ...source,
              title: true,
              validUntil: true,
              workspace: { select: { name: true, logoUrl: true } },
            },
          },
          version: { select: { ...source, number: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load document export job', error))
    }
  },

  /** PENDING → RUNNING. `false` when another run already took it. */
  async markRunning(id: string): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.documentExport.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'RUNNING' },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to mark document export running', error))
    }
  },

  async markReady(
    id: string,
    data: {
      storageKey: string
      sizeBytes: number
      pageCount: number
      finishedAt: Date
      expiresAt: Date
    },
  ): Promise<Result<void>> {
    try {
      await prisma.documentExport.update({
        where: { id },
        data: { ...data, status: 'READY', error: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark document export ready', error))
    }
  },

  async markFailed(
    id: string,
    message: string,
    finishedAt: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.documentExport.update({
        where: { id },
        data: { status: 'FAILED', error: message, finishedAt },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark document export failed', error))
    }
  },

  /** Expired READY exports and dead/failed ones older than `staleBefore`. */
  async listPrunable(
    now: Date,
    staleBefore: Date,
    limit = 1000,
  ): Promise<Result<PrunableExport[]>> {
    try {
      const rows = await prisma.documentExport.findMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              status: { in: ['PENDING', 'RUNNING', 'FAILED'] },
              createdAt: { lt: staleBefore },
            },
          ],
        },
        select: { id: true, storageKey: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list prunable document exports', error))
    }
  },

  async deleteMany(ids: string[]): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const { count } = await prisma.documentExport.deleteMany({
        where: { id: { in: ids } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to delete document exports', error))
    }
  },

  /** `PDF_DOWNLOADED` on the document timeline (public link). */
  async recordDownload(data: {
    documentId: string
    workspaceId: string
    recipientId: string | null
    exportId: string
    versionNumber: number | null
  }): Promise<Result<void>> {
    try {
      await prisma.documentEvent.create({
        data: {
          documentId: data.documentId,
          workspaceId: data.workspaceId,
          recipientId: data.recipientId,
          type: 'PDF_DOWNLOADED',
          data: { exportId: data.exportId, versionNumber: data.versionNumber },
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record document PDF download', error))
    }
  },
}
