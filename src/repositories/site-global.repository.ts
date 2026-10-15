import type { Prisma, SiteGlobal, SiteGlobalKind } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const SiteGlobalRepository = {
  async listBySite(siteId: string): Promise<Result<SiteGlobal[]>> {
    try {
      const globals = await prisma.siteGlobal.findMany({
        where: { siteId },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      })
      return ok(globals)
    } catch (error) {
      return err(dbError('Failed to list site globals', error))
    }
  },

  async findById(id: string, siteId: string): Promise<Result<SiteGlobal>> {
    try {
      const global = await prisma.siteGlobal.findFirst({
        where: { id, siteId },
      })
      if (!global) {
        return err(
          appError('SITE_GLOBAL_NOT_FOUND', 'Componente global não encontrado'),
        )
      }
      return ok(global)
    } catch (error) {
      return err(dbError('Failed to find site global', error))
    }
  },

  async countByKind(
    siteId: string,
    kind?: SiteGlobalKind,
  ): Promise<Result<number>> {
    try {
      return ok(
        await prisma.siteGlobal.count({
          where: { siteId, ...(kind ? { kind } : {}) },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count site globals', error))
    }
  },

  async create(data: {
    siteId: string
    kind: SiteGlobalKind
    name: string
    document: Prisma.InputJsonValue
  }): Promise<Result<SiteGlobal>> {
    try {
      return ok(await prisma.siteGlobal.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create site global', error))
    }
  },

  async update(
    id: string,
    data: { name?: string; document?: Prisma.InputJsonValue },
  ): Promise<Result<SiteGlobal>> {
    try {
      return ok(await prisma.siteGlobal.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update site global', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.siteGlobal.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site global', error))
    }
  },
}
