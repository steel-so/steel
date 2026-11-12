import type { Document, DocumentVersion, Prisma } from '@prisma/client'
import {
  documentNotFound,
  documentTemplateNotFound,
} from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { ListDocumentsQuery } from '@/src/schemas/document.schema'
import { dbError } from './db-error'

/**
 * Documents of CRM > Documentos (ADR 0063). Pure Prisma access: business
 * rules (status machine, authorization, validity) live in the services.
 */

export const DOCUMENT_LIST_INCLUDE = {
  owner: { select: { id: true, name: true, image: true } },
  company: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
  opportunity: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  _count: { select: { sessions: true } },
} satisfies Prisma.DocumentInclude

export type DocumentListRow = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_LIST_INCLUDE
}>

export const DOCUMENT_VERSION_SUMMARY_SELECT = {
  id: true,
  number: true,
  sha256: true,
  createdAt: true,
  createdById: true,
} satisfies Prisma.DocumentVersionSelect

export type DocumentPersonRef = { id: string; name: string }

export type DocumentVersionSummary = Prisma.DocumentVersionGetPayload<{
  select: typeof DOCUMENT_VERSION_SUMMARY_SELECT
}> & { createdBy: DocumentPersonRef | null }

const DOCUMENT_FULL_INCLUDE = {
  ...DOCUMENT_LIST_INCLUDE,
  owner: { select: { id: true, name: true, image: true, email: true } },
  workspace: { select: { name: true, slug: true } },
  currentVersion: { select: DOCUMENT_VERSION_SUMMARY_SELECT },
  recipients: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DocumentInclude

type DocumentFullRow = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_FULL_INCLUDE
}>

export type DocumentFull = Omit<DocumentFullRow, 'currentVersion'> & {
  currentVersion: DocumentVersionSummary | null
}

export type DocumentMeta = Pick<
  Document,
  | 'id'
  | 'workspaceId'
  | 'status'
  | 'isTemplate'
  | 'updatedAt'
  | 'currentVersionId'
>

export type DocumentLinkTarget = Pick<
  Document,
  | 'id'
  | 'workspaceId'
  | 'status'
  | 'isTemplate'
  | 'linkEnabled'
  | 'currentVersionId'
>

/** What the public link needs: the frozen version and the brand. */
export type DocumentPublicContext = Document & {
  currentVersion: DocumentVersion | null
  workspace: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
  }
  owner: { id: string; name: string; email: string }
}

/** CRM records behind the merge tags (`{{contato.nome}}`...). */
export type DocumentVariableContext = Document & {
  person: { name: string; emails: string[]; phones: string[] } | null
  company: { name: string; cnpj: string | null } | null
  opportunity: { name: string; amount: Prisma.Decimal | null } | null
  lead: { name: string; emails: string[]; phones: string[] } | null
  owner: { name: string; email: string }
  workspace: { name: string }
}

/** Sent/viewed document past its validity, with what the e-mail needs. */
export type DocumentExpirationCandidate = Document & {
  owner: { id: string; name: string; email: string }
  workspace: { id: string; name: string; slug: string }
}

/** Statuses in which the validity runs (sent and still unanswered). */
export const DOCUMENT_OPEN_STATUSES = ['SENT', 'VIEWED'] as const

/** Names of the users that froze each version (no relation on the model). */
export async function documentCreators(
  ids: (string | null)[],
): Promise<Map<string, DocumentPersonRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })
  return new Map(users.map((user) => [user.id, user]))
}

async function withCreator(row: DocumentFullRow): Promise<DocumentFull> {
  if (!row.currentVersion) return { ...row, currentVersion: null }
  const creators = await documentCreators([row.currentVersion.createdById])
  return {
    ...row,
    currentVersion: {
      ...row.currentVersion,
      createdBy: creators.get(row.currentVersion.createdById ?? '') ?? null,
    },
  }
}

function listWhere(
  workspaceId: string,
  query: ListDocumentsQuery,
): Prisma.DocumentWhereInput {
  return {
    workspaceId,
    deletedAt: null,
    isTemplate: query.isTemplate,
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.personId ? { personId: query.personId } : {}),
    ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.q
      ? { title: { contains: query.q, mode: 'insensitive' as const } }
      : {}),
  }
}

export const DocumentRepository = {
  async list(
    workspaceId: string,
    query: ListDocumentsQuery,
  ): Promise<Result<{ items: DocumentListRow[]; total: number }>> {
    try {
      const where = listWhere(workspaceId, query)
      const [items, total] = await prisma.$transaction([
        prisma.document.findMany({
          where,
          include: DOCUMENT_LIST_INCLUDE,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.document.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list documents', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<DocumentFull>> {
    try {
      const row = await prisma.document.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: DOCUMENT_FULL_INCLUDE,
      })
      if (!row) return err(documentNotFound())
      return ok(await withCreator(row))
    } catch (error) {
      return err(dbError('Failed to find document', error))
    }
  },

  /** Light read for autosave and the sub-resources (no relations). */
  async findMeta(
    id: string,
    workspaceId: string,
  ): Promise<Result<DocumentMeta>> {
    try {
      const row = await prisma.document.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          isTemplate: true,
          updatedAt: true,
          currentVersionId: true,
        },
      })
      if (!row) return err(documentNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document', error))
    }
  },

  async findTemplate(
    id: string,
    workspaceId: string,
  ): Promise<Result<Document>> {
    try {
      const row = await prisma.document.findFirst({
        where: { id, workspaceId, isTemplate: true, deletedAt: null },
      })
      if (!row) return err(documentTemplateNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document template', error))
    }
  },

  async create(
    data: Prisma.DocumentUncheckedCreateInput,
  ): Promise<Result<DocumentFull>> {
    try {
      const row = await prisma.document.create({
        data,
        include: DOCUMENT_FULL_INCLUDE,
      })
      return ok(await withCreator(row))
    } catch (error) {
      return err(dbError('Failed to create document', error))
    }
  },

  async update(
    id: string,
    data: Prisma.DocumentUncheckedUpdateInput,
  ): Promise<Result<DocumentFull>> {
    try {
      const row = await prisma.document.update({
        where: { id },
        data,
        include: DOCUMENT_FULL_INCLUDE,
      })
      return ok(await withCreator(row))
    } catch (error) {
      return err(dbError('Failed to update document', error))
    }
  },

  /**
   * Autosave. With `baseUpdatedAt` the write only lands when the stored copy
   * is still that one; `null` = someone saved in between (conflict).
   */
  async saveContent(
    id: string,
    input: {
      content: Prisma.InputJsonValue
      theme?: Prisma.InputJsonValue
      updatedById: string
      baseUpdatedAt?: Date
    },
  ): Promise<Result<Date | null>> {
    try {
      const { count } = await prisma.document.updateMany({
        where: {
          id,
          deletedAt: null,
          ...(input.baseUpdatedAt ? { updatedAt: input.baseUpdatedAt } : {}),
        },
        data: {
          content: input.content,
          ...(input.theme !== undefined ? { theme: input.theme } : {}),
          updatedById: input.updatedById,
        },
      })
      if (count === 0) return ok(null)
      const row = await prisma.document.findUniqueOrThrow({
        where: { id },
        select: { updatedAt: true },
      })
      return ok(row.updatedAt)
    } catch (error) {
      return err(dbError('Failed to save document content', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.document.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete document', error))
    }
  },

  /** Link state of a document, by id or by its generic token. */
  async findLinkTarget(
    where: { id: string } | { publicToken: string },
  ): Promise<Result<DocumentLinkTarget | null>> {
    try {
      const row = await prisma.document.findFirst({
        where: { ...where, deletedAt: null },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          isTemplate: true,
          linkEnabled: true,
          currentVersionId: true,
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find document by token', error))
    }
  },

  async findPublicContext(id: string): Promise<Result<DocumentPublicContext>> {
    try {
      const row = await prisma.document.findFirst({
        where: { id, deletedAt: null },
        include: {
          currentVersion: true,
          workspace: {
            select: { id: true, name: true, slug: true, logoUrl: true },
          },
          owner: { select: { id: true, name: true, email: true } },
        },
      })
      if (!row) return err(documentNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load the public document', error))
    }
  },

  async findVariableContext(
    id: string,
  ): Promise<Result<DocumentVariableContext>> {
    try {
      const row = await prisma.document.findFirst({
        where: { id, deletedAt: null },
        include: {
          person: { select: { name: true, emails: true, phones: true } },
          company: { select: { name: true, cnpj: true } },
          opportunity: { select: { name: true, amount: true } },
          lead: { select: { name: true, emails: true, phones: true } },
          owner: { select: { name: true, email: true } },
          workspace: { select: { name: true } },
        },
      })
      if (!row) return err(documentNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load the document variables', error))
    }
  },

  /**
   * First read of the link: SENT → VIEWED and the view timestamps.
   * `firstView` tells whether this was the first read of the document.
   */
  async markViewed(
    id: string,
    at: Date,
  ): Promise<Result<{ firstView: boolean }>> {
    try {
      const [, first] = await prisma.$transaction([
        prisma.document.updateMany({
          where: { id, status: 'SENT' },
          data: { status: 'VIEWED' },
        }),
        prisma.document.updateMany({
          where: { id, firstViewedAt: null },
          data: { firstViewedAt: at },
        }),
        prisma.document.updateMany({
          where: { id },
          data: { lastViewedAt: at },
        }),
      ])
      return ok({ firstView: first.count === 1 })
    } catch (error) {
      return err(dbError('Failed to mark document as viewed', error))
    }
  },

  async listExpirationCandidates(
    now: Date,
  ): Promise<Result<DocumentExpirationCandidate[]>> {
    try {
      const rows = await prisma.document.findMany({
        where: {
          status: { in: [...DOCUMENT_OPEN_STATUSES] },
          isTemplate: false,
          deletedAt: null,
          validUntil: { not: null, lt: now },
        },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { validUntil: 'asc' },
        take: 500,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list documents to expire', error))
    }
  },

  /**
   * SENT/VIEWED → EXPIRED with its timeline event, in one transaction.
   * `false` = the status changed before (answered, archived, re-sent).
   */
  async markExpired(id: string, at: Date): Promise<Result<boolean>> {
    try {
      const expired = await prisma.$transaction(async (tx) => {
        const { count } = await tx.document.updateMany({
          where: { id, status: { in: [...DOCUMENT_OPEN_STATUSES] } },
          data: { status: 'EXPIRED', expiredAt: at },
        })
        if (count === 0) return false
        const row = await tx.document.findUniqueOrThrow({
          where: { id },
          select: { workspaceId: true, validUntil: true },
        })
        await tx.documentEvent.create({
          data: {
            documentId: id,
            workspaceId: row.workspaceId,
            type: 'EXPIRED',
            data: { validUntil: row.validUntil?.toISOString() ?? null },
          },
        })
        return true
      })
      return ok(expired)
    } catch (error) {
      return err(dbError('Failed to expire document', error))
    }
  },
}
