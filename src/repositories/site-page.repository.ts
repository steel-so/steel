import type { Prisma, SitePage } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

export type SitePageSummary = Omit<SitePage, 'document'>

const pageNotFound = () =>
  appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada')

const pathTaken = () =>
  appError(
    'SITE_PAGE_PATH_TAKEN',
    'Já existe uma página neste endereço do site',
  )

export const SitePageRepository = {
  /** Pages of a site in menu order, without their documents. */
  async listBySite(siteId: string): Promise<Result<SitePageSummary[]>> {
    try {
      const pages = await prisma.sitePage.findMany({
        where: { siteId },
        omit: { document: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
      return ok(pages)
    } catch (error) {
      return err(dbError('Failed to list site pages', error))
    }
  },

  /** Pages with their documents (publish). */
  async listWithDocuments(siteId: string): Promise<Result<SitePage[]>> {
    try {
      const pages = await prisma.sitePage.findMany({
        where: { siteId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
      return ok(pages)
    } catch (error) {
      return err(dbError('Failed to list site pages', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.sitePage.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site pages', error))
    }
  },

  async findById(id: string, siteId: string): Promise<Result<SitePage>> {
    try {
      const page = await prisma.sitePage.findFirst({ where: { id, siteId } })
      if (!page) return err(pageNotFound())
      return ok(page)
    } catch (error) {
      return err(dbError('Failed to find site page', error))
    }
  },

  async isPathTaken(
    siteId: string,
    path: string,
    exceptId?: string,
  ): Promise<Result<boolean>> {
    try {
      const page = await prisma.sitePage.findUnique({
        where: { siteId_path: { siteId, path } },
        select: { id: true },
      })
      return ok(Boolean(page && page.id !== exceptId))
    } catch (error) {
      return err(dbError('Failed to check site page path', error))
    }
  },

  /** Appends a page at the end of the menu. */
  async create(data: {
    siteId: string
    parentId: string | null
    title: string
    slug: string
    path: string
    document: Prisma.InputJsonValue
    seo: Prisma.InputJsonValue
  }): Promise<Result<SitePage>> {
    try {
      const position = await prisma.sitePage.count({
        where: { siteId: data.siteId },
      })
      return ok(await prisma.sitePage.create({ data: { ...data, position } }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(pathTaken())
      return err(dbError('Failed to create site page', error))
    }
  },

  /** Updates a page and rewrites the paths of its subtree in one go. */
  async update(
    id: string,
    data: {
      title?: string
      slug?: string
      path?: string
      parentId?: string | null
      document?: Prisma.InputJsonValue
      seo?: Prisma.InputJsonValue
    },
    descendantPaths: Array<{ id: string; path: string }> = [],
  ): Promise<Result<SitePage>> {
    try {
      const [page] = await prisma.$transaction([
        prisma.sitePage.update({ where: { id }, data }),
        ...descendantPaths.map((child) =>
          prisma.sitePage.update({
            where: { id: child.id },
            data: { path: child.path },
          }),
        ),
      ])
      return ok(page)
    } catch (error) {
      if (isUniqueViolation(error)) return err(pathTaken())
      return err(dbError('Failed to update site page', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.sitePage.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site page', error))
    }
  },

  async reorder(siteId: string, orderedIds: string[]): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.sitePage.update({
            where: { id, siteId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder site pages', error))
    }
  },

  /** Makes `pageId` the only home page of the site. */
  async setHome(siteId: string, pageId: string): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.sitePage.updateMany({
          where: { siteId, isHome: true, id: { not: pageId } },
          data: { isHome: false },
        }),
        prisma.sitePage.update({
          where: { id: pageId, siteId },
          data: { isHome: true },
        }),
        prisma.site.update({
          where: { id: siteId },
          data: { homePageId: pageId },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to set the site home page', error))
    }
  },
}
