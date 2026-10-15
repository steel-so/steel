import type { SiteRedirect } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

const pathTaken = () =>
  appError(
    'SITE_REDIRECT_PATH_TAKEN',
    'Já existe um redirecionamento a partir deste endereço',
  )

export const SiteRedirectRepository = {
  async listBySite(siteId: string): Promise<Result<SiteRedirect[]>> {
    try {
      return ok(
        await prisma.siteRedirect.findMany({
          where: { siteId },
          orderBy: { fromPath: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site redirects', error))
    }
  },

  /** Redirects of a published, non-deleted site by its slug (runtime). */
  async listBySiteSlug(slug: string): Promise<Result<SiteRedirect[]>> {
    try {
      return ok(
        await prisma.siteRedirect.findMany({
          where: { site: { slug, deletedAt: null } },
          orderBy: { fromPath: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site redirects', error))
    }
  },

  async findById(id: string, siteId: string): Promise<Result<SiteRedirect>> {
    try {
      const redirect = await prisma.siteRedirect.findFirst({
        where: { id, siteId },
      })
      if (!redirect) {
        return err(
          appError(
            'SITE_REDIRECT_NOT_FOUND',
            'Redirecionamento não encontrado',
          ),
        )
      }
      return ok(redirect)
    } catch (error) {
      return err(dbError('Failed to find site redirect', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteRedirect.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site redirects', error))
    }
  },

  async create(data: {
    siteId: string
    fromPath: string
    toPath: string
    permanent: boolean
  }): Promise<Result<SiteRedirect>> {
    try {
      return ok(await prisma.siteRedirect.create({ data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(pathTaken())
      return err(dbError('Failed to create site redirect', error))
    }
  },

  async update(
    id: string,
    data: { fromPath?: string; toPath?: string; permanent?: boolean },
  ): Promise<Result<SiteRedirect>> {
    try {
      return ok(await prisma.siteRedirect.update({ where: { id }, data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(pathTaken())
      return err(dbError('Failed to update site redirect', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.siteRedirect.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site redirect', error))
    }
  },
}
