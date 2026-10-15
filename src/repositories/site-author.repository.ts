import type { Prisma, SiteAuthor } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/** Public author profiles of a site's blog (slice site-blog). */

export type SiteAuthorWithCount = SiteAuthor & { _count: { posts: number } }

const withCount = { _count: { select: { posts: true } } } as const

const taken = () =>
  appError(
    'SITE_AUTHOR_TAKEN',
    'Já existe um autor com este endereço ou para este membro',
  )

export const SiteAuthorRepository = {
  async list(siteId: string): Promise<Result<SiteAuthorWithCount[]>> {
    try {
      return ok(
        await prisma.siteAuthor.findMany({
          where: { siteId },
          include: withCount,
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site authors', error))
    }
  },

  async findById(
    id: string,
    siteId: string,
  ): Promise<Result<SiteAuthorWithCount>> {
    try {
      const author = await prisma.siteAuthor.findFirst({
        where: { id, siteId },
        include: withCount,
      })
      return author
        ? ok(author)
        : err(appError('SITE_AUTHOR_NOT_FOUND', 'Autor não encontrado'))
    } catch (error) {
      return err(dbError('Failed to find site author', error))
    }
  },

  async findByUser(
    siteId: string,
    userId: string,
  ): Promise<Result<SiteAuthor | null>> {
    try {
      return ok(
        await prisma.siteAuthor.findFirst({ where: { siteId, userId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find site author', error))
    }
  },

  async slugsLike(siteId: string, base: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.siteAuthor.findMany({
        where: { siteId, slug: { startsWith: base } },
        select: { slug: true },
      })
      return ok(rows.map((row) => row.slug))
    } catch (error) {
      return err(dbError('Failed to list site author slugs', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteAuthor.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site authors', error))
    }
  },

  async create(data: {
    siteId: string
    userId?: string | null
    name: string
    slug: string
    bio?: string | null
    avatarUrl?: string | null
    links?: Prisma.InputJsonValue
  }): Promise<Result<SiteAuthorWithCount>> {
    try {
      return ok(await prisma.siteAuthor.create({ data, include: withCount }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(taken())
      return err(dbError('Failed to create site author', error))
    }
  },

  async update(
    id: string,
    data: {
      userId?: string | null
      name?: string
      slug?: string
      bio?: string | null
      avatarUrl?: string | null
      links?: Prisma.InputJsonValue
    },
  ): Promise<Result<SiteAuthorWithCount>> {
    try {
      return ok(
        await prisma.siteAuthor.update({
          where: { id },
          data,
          include: withCount,
        }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(taken())
      return err(dbError('Failed to update site author', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.siteAuthor.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site author', error))
    }
  },
}
