import type {
  CrmCustomerHealth,
  CrmHealthLevel,
  CrmOpportunityHealth,
  Prisma,
} from '@prisma/client'
import type {
  HealthComputation,
  HealthNextAction,
} from '@/src/lib/crm-health/core'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Stored health rows (T4 customers, C4 deals) and the worklists the recompute
 * job walks. The signals a score is computed from live in
 * `crm-health-signals.repository.ts`.
 */

export type CrmCustomerHealthWithCompany = CrmCustomerHealth & {
  company: { name: string; accountOwnerId: string | null }
}

export type CrmOpportunityHealthWithDeal = CrmOpportunityHealth & {
  opportunity: { name: string; ownerId: string | null }
}

/** What an upsert reports back: the new row and what it replaced. */
export interface HealthUpsertResult<Row> {
  row: Row
  previousLevel: CrmHealthLevel | null
  previousScore: number | null
}

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue

function storedFields(
  computation: HealthComputation,
  signals: unknown,
  previous: { riskScore: number; level: CrmHealthLevel } | null,
  computedAt: Date,
) {
  return {
    riskScore: computation.riskScore,
    level: computation.level,
    factors: toJson(computation.factors),
    nextAction: toJson(computation.nextAction satisfies HealthNextAction),
    signals: toJson(signals),
    previousScore: previous?.riskScore ?? null,
    previousLevel: previous?.level ?? null,
    computedAt,
  }
}

export const CrmHealthRepository = {
  // ─── workspaces ───────────────────────────────────────────────────────────

  /** Active workspaces with the CRM module on (the worker tick). */
  async listCrmWorkspaceIds(): Promise<Result<string[]>> {
    try {
      const rows = await prisma.workspaceModuleAccess.findMany({
        where: {
          module: 'CRM',
          enabled: true,
          workspace: { status: 'ACTIVE' },
        },
        select: { workspaceId: true },
        orderBy: { workspaceId: 'asc' },
      })
      return ok(rows.map((row) => row.workspaceId))
    } catch (error) {
      return err(dbError('Failed to list CRM workspaces', error))
    }
  },

  // ─── customers (T4) ───────────────────────────────────────────────────────

  async findCompany(
    workspaceId: string,
    companyId: string,
  ): Promise<
    Result<{
      id: string
      name: string
      cnpj: string | null
      accountOwnerId: string | null
      createdAt: Date
    } | null>
  > {
    try {
      const company = await prisma.crmCompany.findFirst({
        where: { id: companyId, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          cnpj: true,
          accountOwnerId: true,
          createdAt: true,
        },
      })
      return ok(company)
    } catch (error) {
      return err(
        dbError('Failed to find the company for the health score', error),
      )
    }
  },

  /**
   * Companies to recompute, never-scored first and then the stalest score,
   * so a capped run walks the whole base over successive ticks.
   */
  async listCompaniesToCompute(
    workspaceId: string,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const fresh = await prisma.crmCompany.findMany({
        where: { workspaceId, deletedAt: null, health: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      const ids = fresh.map((row) => row.id)
      if (ids.length < limit) {
        const stale = await prisma.crmCompany.findMany({
          where: { workspaceId, deletedAt: null, health: { isNot: null } },
          select: { id: true },
          orderBy: { health: { computedAt: 'asc' } },
          take: limit - ids.length,
        })
        ids.push(...stale.map((row) => row.id))
      }
      return ok(ids)
    } catch (error) {
      return err(dbError('Failed to list companies to score', error))
    }
  },

  async getCustomerHealth(
    workspaceId: string,
    companyId: string,
  ): Promise<Result<CrmCustomerHealth | null>> {
    try {
      const row = await prisma.crmCustomerHealth.findFirst({
        where: { workspaceId, companyId, company: { deletedAt: null } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to read the customer health', error))
    }
  },

  async listCustomerHealth(
    workspaceId: string,
    filters: { level?: CrmHealthLevel; limit: number },
  ): Promise<Result<CrmCustomerHealthWithCompany[]>> {
    try {
      const rows = await prisma.crmCustomerHealth.findMany({
        where: {
          workspaceId,
          company: { deletedAt: null },
          ...(filters.level ? { level: filters.level } : {}),
        },
        include: { company: { select: { name: true, accountOwnerId: true } } },
        orderBy: [{ riskScore: 'desc' }, { computedAt: 'desc' }],
        take: filters.limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list customer health', error))
    }
  },

  async upsertCustomerHealth(
    workspaceId: string,
    companyId: string,
    computation: HealthComputation,
    signals: unknown,
    computedAt: Date,
  ): Promise<Result<HealthUpsertResult<CrmCustomerHealth>>> {
    try {
      const existing = await prisma.crmCustomerHealth.findUnique({
        where: { companyId },
        select: { riskScore: true, level: true },
      })
      const fields = {
        ...storedFields(computation, signals, existing, computedAt),
        missing: toJson(computation.missing),
      }
      const row = await prisma.crmCustomerHealth.upsert({
        where: { companyId },
        create: { workspaceId, companyId, ...fields },
        update: fields,
      })
      return ok({
        row,
        previousLevel: existing?.level ?? null,
        previousScore: existing?.riskScore ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to save the customer health', error))
    }
  },

  // ─── opportunities (C4) ───────────────────────────────────────────────────

  async findOpportunity(
    workspaceId: string,
    opportunityId: string,
  ): Promise<
    Result<{
      id: string
      name: string
      ownerId: string | null
      companyId: string | null
      pointOfContactId: string | null
      closeDate: Date | null
      createdAt: Date
      updatedAt: Date
      stageChangedAt: Date | null
      contactChangedAt: Date | null
      isOpen: boolean
    } | null>
  > {
    try {
      const row = await prisma.crmOpportunity.findFirst({
        where: { id: opportunityId, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          ownerId: true,
          companyId: true,
          pointOfContactId: true,
          closeDate: true,
          createdAt: true,
          updatedAt: true,
          stageChangedAt: true,
          contactChangedAt: true,
          stage: { select: { category: true } },
        },
      })
      if (!row) return ok(null)
      const { stage, ...rest } = row
      return ok({ ...rest, isOpen: stage.category === 'OPEN' })
    } catch (error) {
      return err(dbError('Failed to find the deal for the health score', error))
    }
  },

  /** Open deals to recompute: never scored first, then the stalest score. */
  async listOpportunitiesToCompute(
    workspaceId: string,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const open = {
        workspaceId,
        deletedAt: null,
        stage: { category: 'OPEN' as const },
      }
      const fresh = await prisma.crmOpportunity.findMany({
        where: { ...open, health: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      const ids = fresh.map((row) => row.id)
      if (ids.length < limit) {
        const stale = await prisma.crmOpportunity.findMany({
          where: { ...open, health: { isNot: null } },
          select: { id: true },
          orderBy: { health: { computedAt: 'asc' } },
          take: limit - ids.length,
        })
        ids.push(...stale.map((row) => row.id))
      }
      return ok(ids)
    } catch (error) {
      return err(dbError('Failed to list deals to score', error))
    }
  },

  /** Drops the rows of deals that are no longer open (won, lost, deleted). */
  async deleteClosedOpportunityHealth(
    workspaceId: string,
  ): Promise<Result<number>> {
    try {
      const result = await prisma.crmOpportunityHealth.deleteMany({
        where: {
          workspaceId,
          OR: [
            { opportunity: { deletedAt: { not: null } } },
            { opportunity: { stage: { category: { not: 'OPEN' } } } },
          ],
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to clean the closed deal health rows', error))
    }
  },

  async deleteOpportunityHealth(opportunityId: string): Promise<Result<void>> {
    try {
      await prisma.crmOpportunityHealth.deleteMany({ where: { opportunityId } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete the deal health', error))
    }
  },

  async getOpportunityHealth(
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<CrmOpportunityHealth | null>> {
    try {
      const row = await prisma.crmOpportunityHealth.findFirst({
        where: {
          workspaceId,
          opportunityId,
          opportunity: { deletedAt: null },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to read the deal health', error))
    }
  },

  async listOpportunityHealth(
    workspaceId: string,
    filters: {
      pipelineId?: string
      level?: CrmHealthLevel
      limit: number
    },
  ): Promise<Result<CrmOpportunityHealthWithDeal[]>> {
    try {
      const rows = await prisma.crmOpportunityHealth.findMany({
        where: {
          workspaceId,
          opportunity: {
            deletedAt: null,
            ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
          },
          ...(filters.level ? { level: filters.level } : {}),
        },
        include: { opportunity: { select: { name: true, ownerId: true } } },
        orderBy: [{ riskScore: 'desc' }, { computedAt: 'desc' }],
        take: filters.limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list deal health', error))
    }
  },

  /** Health of the open deals of one company (feeds the customer score). */
  async countOpenDealsByLevel(
    workspaceId: string,
    companyId: string,
  ): Promise<Result<Record<CrmHealthLevel, number>>> {
    try {
      const groups = await prisma.crmOpportunityHealth.groupBy({
        by: ['level'],
        where: {
          workspaceId,
          opportunity: {
            companyId,
            deletedAt: null,
            stage: { category: 'OPEN' },
          },
        },
        _count: { _all: true },
      })
      const counts: Record<CrmHealthLevel, number> = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
      }
      for (const group of groups) counts[group.level] = group._count._all
      return ok(counts)
    } catch (error) {
      return err(dbError('Failed to count the deal health by level', error))
    }
  },

  async upsertOpportunityHealth(
    workspaceId: string,
    opportunityId: string,
    computation: HealthComputation,
    signals: unknown,
    computedAt: Date,
  ): Promise<Result<HealthUpsertResult<CrmOpportunityHealth>>> {
    try {
      const existing = await prisma.crmOpportunityHealth.findUnique({
        where: { opportunityId },
        select: { riskScore: true, level: true },
      })
      const fields = storedFields(computation, signals, existing, computedAt)
      const row = await prisma.crmOpportunityHealth.upsert({
        where: { opportunityId },
        create: { workspaceId, opportunityId, ...fields },
        update: fields,
      })
      return ok({
        row,
        previousLevel: existing?.level ?? null,
        previousScore: existing?.riskScore ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to save the deal health', error))
    }
  },
}
