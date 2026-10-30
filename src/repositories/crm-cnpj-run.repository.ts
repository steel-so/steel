import type {
  CrmCnpjEnrichmentRun,
  CrmCnpjRunStatus,
  CrmCompany,
} from '@prisma/client'
import { crmCnpjRunNotFound } from '@/src/errors'
import { crmCnpjRunNotCancelable } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const ACTIVE: CrmCnpjRunStatus[] = ['QUEUED', 'RUNNING']

/** Pure Prisma access to the bulk CNPJ enrichment runs. */
export const CrmCnpjRunRepository = {
  async create(data: {
    workspaceId: string
    createdById: string
    onlyMissing: boolean
    overwrite: boolean
    total: number
  }): Promise<Result<CrmCnpjEnrichmentRun>> {
    try {
      return ok(await prisma.crmCnpjEnrichmentRun.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create CNPJ enrichment run', error))
    }
  },

  async findActive(
    workspaceId: string,
  ): Promise<Result<CrmCnpjEnrichmentRun | null>> {
    try {
      return ok(
        await prisma.crmCnpjEnrichmentRun.findFirst({
          where: { workspaceId, status: { in: ACTIVE } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find active CNPJ enrichment run', error))
    }
  },

  async listByWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<Result<CrmCnpjEnrichmentRun[]>> {
    try {
      return ok(
        await prisma.crmCnpjEnrichmentRun.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CNPJ enrichment runs', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCnpjEnrichmentRun>> {
    try {
      const row = await prisma.crmCnpjEnrichmentRun.findFirst({
        where: { id, workspaceId },
      })
      return row ? ok(row) : err(crmCnpjRunNotFound())
    } catch (error) {
      return err(dbError('Failed to find CNPJ enrichment run', error))
    }
  },

  /** Worker lookup: the job only carries the run id. */
  async findByIdForWorker(id: string): Promise<Result<CrmCnpjEnrichmentRun>> {
    try {
      const row = await prisma.crmCnpjEnrichmentRun.findUnique({
        where: { id },
      })
      return row ? ok(row) : err(crmCnpjRunNotFound())
    } catch (error) {
      return err(dbError('Failed to find CNPJ enrichment run', error))
    }
  },

  async update(
    id: string,
    data: {
      status?: CrmCnpjRunStatus
      processed?: number
      enriched?: number
      notFound?: number
      invalid?: number
      failed?: number
      error?: string | null
      startedAt?: Date
      finishedAt?: Date
    },
  ): Promise<Result<CrmCnpjEnrichmentRun>> {
    try {
      return ok(
        await prisma.crmCnpjEnrichmentRun.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update CNPJ enrichment run', error))
    }
  },

  /**
   * Asks the run to stop. A queued run is cancelled at once (the worker will
   * find it finished); a running one only gets the flag, the worker stops
   * between two companies. Anything else is not cancelable.
   */
  async requestCancel(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCnpjEnrichmentRun>> {
    try {
      const now = new Date()
      const queued = await prisma.crmCnpjEnrichmentRun.updateMany({
        where: { id, workspaceId, status: 'QUEUED' },
        data: { status: 'CANCELED', cancelRequestedAt: now, finishedAt: now },
      })
      if (queued.count === 0) {
        const running = await prisma.crmCnpjEnrichmentRun.updateMany({
          where: { id, workspaceId, status: 'RUNNING' },
          data: { cancelRequestedAt: now },
        })
        if (running.count === 0) {
          const exists = await prisma.crmCnpjEnrichmentRun.findFirst({
            where: { id, workspaceId },
            select: { id: true },
          })
          return err(exists ? crmCnpjRunNotCancelable() : crmCnpjRunNotFound())
        }
      }
      const row = await prisma.crmCnpjEnrichmentRun.findUnique({
        where: { id },
      })
      return row ? ok(row) : err(crmCnpjRunNotFound())
    } catch (error) {
      return err(dbError('Failed to cancel CNPJ enrichment run', error))
    }
  },

  /** Worker check between companies: did an admin ask to stop? */
  async isCancelRequested(id: string): Promise<Result<boolean>> {
    try {
      const row = await prisma.crmCnpjEnrichmentRun.findUnique({
        where: { id },
        select: { cancelRequestedAt: true, status: true },
      })
      return ok(
        Boolean(row && (row.cancelRequestedAt || row.status === 'CANCELED')),
      )
    } catch (error) {
      return err(dbError('Failed to read CNPJ enrichment run', error))
    }
  },

  /**
   * Companies with a CNPJ, in id order, after `afterId`. With `onlyMissing`
   * the ones that already have a Receita profile are left out.
   */
  async listTargets(
    workspaceId: string,
    opts: { onlyMissing: boolean; afterId?: string; take: number },
  ): Promise<Result<CrmCompany[]>> {
    try {
      return ok(
        await prisma.crmCompany.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            cnpj: { not: null },
            ...(opts.onlyMissing ? { enrichment: { is: null } } : {}),
            ...(opts.afterId ? { id: { gt: opts.afterId } } : {}),
          },
          orderBy: { id: 'asc' },
          take: opts.take,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CNPJ enrichment targets', error))
    }
  },

  async countTargets(
    workspaceId: string,
    onlyMissing: boolean,
  ): Promise<Result<number>> {
    try {
      return ok(
        await prisma.crmCompany.count({
          where: {
            workspaceId,
            deletedAt: null,
            cnpj: { not: null },
            ...(onlyMissing ? { enrichment: { is: null } } : {}),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count CNPJ enrichment targets', error))
    }
  },
}
