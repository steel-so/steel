import type {
  CrmCnpjEnrichmentRun,
  CrmCnpjRunStatus,
  CrmCompany,
} from '@prisma/client'
import { crmCnpjRunNotFound } from '@/src/errors'
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
