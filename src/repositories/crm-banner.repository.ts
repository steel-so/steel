import type { CrmBanner, Prisma } from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** A library is browsed, not exported. */
export const CRM_BANNER_LIST_LIMIT = 500

export type CreateCrmBannerData = {
  workspaceId: string
  createdById: string
  name: string
  folder: string
  tags: string[]
  objective: string | null
  document: Prisma.InputJsonValue
}

export type UpdateCrmBannerData = {
  updatedById: string
  name?: string
  folder?: string
  tags?: string[]
  objective?: string | null
  document?: Prisma.InputJsonValue
}

export const CrmBannerRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<CrmBanner[]>> {
    try {
      const banners = await prisma.crmBanner.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: CRM_BANNER_LIST_LIMIT,
      })
      return ok(banners)
    } catch (error) {
      return err(dbError('Failed to list CRM banners', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<CrmBanner>> {
    try {
      const banner = await prisma.crmBanner.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!banner) return err(notFound('CrmBanner'))
      return ok(banner)
    } catch (error) {
      return err(dbError('Failed to find CRM banner by id', error))
    }
  },

  async create(data: CreateCrmBannerData): Promise<Result<CrmBanner>> {
    try {
      const banner = await prisma.crmBanner.create({ data })
      return ok(banner)
    } catch (error) {
      return err(dbError('Failed to create CRM banner', error))
    }
  },

  async update(
    id: string,
    data: UpdateCrmBannerData,
  ): Promise<Result<CrmBanner>> {
    try {
      const banner = await prisma.crmBanner.update({ where: { id }, data })
      return ok(banner)
    } catch (error) {
      return err(dbError('Failed to update CRM banner', error))
    }
  },

  async softDelete(id: string, updatedById: string): Promise<Result<void>> {
    try {
      await prisma.crmBanner.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM banner', error))
    }
  },
}
