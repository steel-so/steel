import type {
  CrmApolloImport,
  CrmApolloImportSource,
  CrmApolloImportStatus,
  Prisma,
} from '@prisma/client'
import { crmApolloImportNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Pure Prisma access to the Apollo import runs (no business rules). */
export const CrmApolloImportRepository = {
  async create(data: {
    workspaceId: string
    createdById: string
    source: CrmApolloImportSource
    filters: Prisma.InputJsonValue
    apolloIds: string[]
    contacts?: Prisma.InputJsonValue
    mailingListId?: string | null
    requestedCount: number
  }): Promise<Result<CrmApolloImport>> {
    try {
      return ok(await prisma.crmApolloImport.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create Apollo import', error))
    }
  },

  async listByWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<Result<CrmApolloImport[]>> {
    try {
      return ok(
        await prisma.crmApolloImport.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list Apollo imports', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmApolloImport>> {
    try {
      const row = await prisma.crmApolloImport.findFirst({
        where: { id, workspaceId },
      })
      return row ? ok(row) : err(crmApolloImportNotFound())
    } catch (error) {
      return err(dbError('Failed to find Apollo import', error))
    }
  },

  /** Worker lookup: the job only carries the import id. */
  async findByIdForWorker(id: string): Promise<Result<CrmApolloImport>> {
    try {
      const row = await prisma.crmApolloImport.findUnique({ where: { id } })
      return row ? ok(row) : err(crmApolloImportNotFound())
    } catch (error) {
      return err(dbError('Failed to find Apollo import', error))
    }
  },

  async setStatus(
    id: string,
    status: CrmApolloImportStatus,
    extra: {
      error?: string | null
      startedAt?: Date
      finishedAt?: Date | null
    } = {},
  ): Promise<Result<CrmApolloImport>> {
    try {
      return ok(
        await prisma.crmApolloImport.update({
          where: { id },
          data: { status, ...extra },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update Apollo import status', error))
    }
  },

  /** Adds one processed batch to the counters and moves the cursor. */
  async addProgress(
    id: string,
    progress: {
      created: number
      skipped: number
      failed: number
      credits: number
      cursor: number
    },
  ): Promise<Result<CrmApolloImport>> {
    try {
      return ok(
        await prisma.crmApolloImport.update({
          where: { id },
          data: {
            createdCount: { increment: progress.created },
            skippedCount: { increment: progress.skipped },
            failedCount: { increment: progress.failed },
            creditsConsumed: { increment: progress.credits },
            cursor: progress.cursor,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to record Apollo import progress', error))
    }
  },
}
