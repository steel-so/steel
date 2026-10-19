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
    id?: string
    revealPhones?: boolean
    webhookTokenHash?: string | null
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
      phonesRequested?: number
      phoneOnlyPeople?: Prisma.InputJsonValue
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
            ...(progress.phonesRequested
              ? { phonesRequested: { increment: progress.phonesRequested } }
              : {}),
            ...(progress.phoneOnlyPeople !== undefined
              ? { phoneOnlyPeople: progress.phoneOnlyPeople }
              : {}),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to record Apollo import progress', error))
    }
  },

  /** Webhook lookup: the URL only carries the token, stored as its hash. */
  async findByWebhookTokenHash(hash: string): Promise<Result<CrmApolloImport>> {
    try {
      const row = await prisma.crmApolloImport.findUnique({
        where: { webhookTokenHash: hash },
      })
      return row ? ok(row) : err(crmApolloImportNotFound())
    } catch (error) {
      return err(dbError('Failed to find Apollo import by webhook', error))
    }
  },

  /** Counters moved by the phone webhook (atomic, safe to repeat per batch). */
  async addPhoneProgress(
    id: string,
    progress: { received: number; created: number; credits: number },
  ): Promise<Result<CrmApolloImport>> {
    try {
      return ok(
        await prisma.crmApolloImport.update({
          where: { id },
          data: {
            phonesReceived: { increment: progress.received },
            createdCount: { increment: progress.created },
            creditsConsumed: { increment: progress.credits },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to record Apollo phone progress', error))
    }
  },
}
