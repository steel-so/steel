import type {
  Prisma,
  SiteExperiment,
  SiteExperimentEventKind,
  SiteExperimentStatus,
} from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface SiteExperimentCount {
  variantKey: string
  kind: SiteExperimentEventKind
  count: number
}

export type SiteExperimentCreateData = {
  siteId: string
  pageId: string
  name: string
  kind: 'SECTION' | 'PAGE'
  controlNodeId: string | null
  variants: Prisma.InputJsonValue
  goal: Prisma.InputJsonValue
  startsAt: Date | null
  endsAt: Date | null
  createdById: string
}

export type SiteExperimentUpdateData = Partial<{
  name: string
  status: SiteExperimentStatus
  variants: Prisma.InputJsonValue
  goal: Prisma.InputJsonValue
  startsAt: Date | null
  endsAt: Date | null
  run: number
  startedAt: Date | null
  endedAt: Date | null
  winnerKey: string | null
  fingerprints: Prisma.InputJsonValue
  updatedById: string | null
}>

const notFound = () =>
  appError('SITE_EXPERIMENT_NOT_FOUND', 'Teste A/B não encontrado')

export const SiteExperimentRepository = {
  async listBySite(siteId: string): Promise<Result<SiteExperiment[]>> {
    try {
      return ok(
        await prisma.siteExperiment.findMany({
          where: { siteId },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site experiments', error))
    }
  },

  /** Running and paused tests of a site (publish hook, conflicts). */
  async listActive(siteId: string): Promise<Result<SiteExperiment[]>> {
    try {
      return ok(
        await prisma.siteExperiment.findMany({
          where: { siteId, status: { in: ['RUNNING', 'PAUSED'] } },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list active site experiments', error))
    }
  },

  /** Running tests of a published, non-deleted site (public runtime). */
  async listRunningBySlug(slug: string): Promise<Result<SiteExperiment[]>> {
    try {
      return ok(
        await prisma.siteExperiment.findMany({
          where: {
            status: 'RUNNING',
            site: { slug, deletedAt: null, status: 'PUBLISHED' },
          },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list running site experiments', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteExperiment.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site experiments', error))
    }
  },

  async findById(id: string, siteId: string): Promise<Result<SiteExperiment>> {
    try {
      const experiment = await prisma.siteExperiment.findFirst({
        where: { id, siteId },
      })
      if (!experiment) return err(notFound())
      return ok(experiment)
    } catch (error) {
      return err(dbError('Failed to find site experiment', error))
    }
  },

  async create(
    data: SiteExperimentCreateData,
  ): Promise<Result<SiteExperiment>> {
    try {
      return ok(await prisma.siteExperiment.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create site experiment', error))
    }
  },

  async update(
    id: string,
    data: SiteExperimentUpdateData,
  ): Promise<Result<SiteExperiment>> {
    try {
      return ok(await prisma.siteExperiment.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update site experiment', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.siteExperiment.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site experiment', error))
    }
  },

  /** Distinct visitors per variant and event kind in one run. */
  async countEvents(
    experimentId: string,
    run: number,
  ): Promise<Result<SiteExperimentCount[]>> {
    try {
      const rows = await prisma.siteExperimentEvent.groupBy({
        by: ['variantKey', 'kind'],
        where: { experimentId, run },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          variantKey: row.variantKey,
          kind: row.kind,
          count: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count site experiment events', error))
    }
  },

  /** Variant a visitor was exposed to in a run; `null` when never. */
  async findExposure(
    experimentId: string,
    run: number,
    visitorKey: string,
  ): Promise<Result<string | null>> {
    try {
      const exposure = await prisma.siteExperimentEvent.findUnique({
        where: {
          experimentId_run_kind_visitorKey: {
            experimentId,
            run,
            kind: 'EXPOSURE',
            visitorKey,
          },
        },
        select: { variantKey: true },
      })
      return ok(exposure?.variantKey ?? null)
    } catch (error) {
      return err(dbError('Failed to find site experiment exposure', error))
    }
  },

  /** Records an event once per visitor, kind and run (repeats are
   * ignored). `true` when a row was written. */
  async recordEvent(data: {
    experimentId: string
    run: number
    variantKey: string
    kind: SiteExperimentEventKind
    visitorKey: string
  }): Promise<Result<boolean>> {
    try {
      const created = await prisma.siteExperimentEvent.createMany({
        data,
        skipDuplicates: true,
      })
      return ok(created.count > 0)
    } catch (error) {
      return err(dbError('Failed to record site experiment event', error))
    }
  },
}
