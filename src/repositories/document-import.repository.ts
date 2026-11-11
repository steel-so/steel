import type {
  Document,
  DocumentImport,
  DocumentImportMode,
  DocumentKind,
  DocumentSource,
  Prisma,
} from '@prisma/client'
import { documentImportNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const json = (value: unknown) => value as Prisma.InputJsonValue

export interface CreateDocumentImportData {
  id?: string
  workspaceId: string
  mode: DocumentImportMode
  kind: DocumentKind
  fileKey?: string | null
  fileName?: string | null
  fileSize?: number | null
  pageCount?: number | null
  prompt?: string | null
  progress: unknown
  createdById: string
}

/** The draft document an import produces. */
export interface ImportedDocumentData {
  workspaceId: string
  kind: DocumentKind
  title: string
  source: DocumentSource
  content: unknown
  theme: unknown
  settings: unknown
  publicToken: string
  ownerId: string
}

/**
 * `DocumentImport` rows (AI import of CRM > Documentos, ADR 0063). Pure
 * Prisma: the import service owns the rules. `complete` creates the draft
 * document, its CREATED event and closes the import in one transaction.
 */
export const DocumentImportRepository = {
  async create(
    data: CreateDocumentImportData,
  ): Promise<Result<DocumentImport>> {
    try {
      const row = await prisma.documentImport.create({
        data: { ...data, progress: json(data.progress) },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create document import', error))
    }
  },

  /** Scoped to the workspace; another workspace's import is not found. */
  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<DocumentImport>> {
    try {
      const row = await prisma.documentImport.findFirst({
        where: { id, workspaceId },
      })
      if (!row) return err(documentImportNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document import', error))
    }
  },

  /** Imports of a user still queued or running in the workspace. */
  async countActive(
    workspaceId: string,
    createdById: string,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.documentImport.count({
        where: {
          workspaceId,
          createdById,
          status: { in: ['PENDING', 'RUNNING'] },
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count active document imports', error))
    }
  },

  /** For the worker, which only has the id. */
  async findForRun(id: string): Promise<Result<DocumentImport | null>> {
    try {
      return ok(await prisma.documentImport.findUnique({ where: { id } }))
    } catch (error) {
      return err(dbError('Failed to load document import', error))
    }
  },

  async update(
    id: string,
    data: {
      status?: DocumentImport['status']
      progress?: unknown
      model?: string | null
      pageCount?: number | null
      kind?: DocumentKind
      costUsd?: number | null
      error?: string | null
      finishedAt?: Date | null
    },
  ): Promise<Result<DocumentImport>> {
    try {
      const { progress, ...rest } = data
      const row = await prisma.documentImport.update({
        where: { id },
        data: {
          ...rest,
          ...(progress !== undefined && { progress: json(progress) }),
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update document import', error))
    }
  },

  async complete(
    id: string,
    document: ImportedDocumentData,
    result: { progress: unknown; costUsd: number; model: string | null },
  ): Promise<Result<{ import: DocumentImport; document: Document }>> {
    try {
      return ok(
        await prisma.$transaction(async (tx) => {
          const created = await tx.document.create({
            data: {
              workspaceId: document.workspaceId,
              kind: document.kind,
              title: document.title,
              source: document.source,
              content: json(document.content),
              theme: json(document.theme),
              settings: json(document.settings),
              publicToken: document.publicToken,
              ownerId: document.ownerId,
              createdById: document.ownerId,
            },
          })
          await tx.documentEvent.create({
            data: {
              documentId: created.id,
              workspaceId: document.workspaceId,
              type: 'CREATED',
              actorId: document.ownerId,
              data: json({ source: document.source, importId: id }),
            },
          })
          const updated = await tx.documentImport.update({
            where: { id },
            data: {
              status: 'READY',
              documentId: created.id,
              kind: document.kind,
              progress: json(result.progress),
              costUsd: result.costUsd,
              model: result.model,
              error: null,
              finishedAt: new Date(),
            },
          })
          return { import: updated, document: created }
        }),
      )
    } catch (error) {
      return err(dbError('Failed to complete document import', error))
    }
  },
}
