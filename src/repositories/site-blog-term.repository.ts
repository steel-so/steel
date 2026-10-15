import type { Prisma, SiteBlogCategory, SiteBlogTag } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/** Categories and tags of a site's blog (slice site-blog). */

export type SiteBlogCategoryWithCount = SiteBlogCategory & {
  _count: { posts: number }
}
export type SiteBlogTagWithCount = SiteBlogTag & { _count: { posts: number } }

const termNotFound = (kind: 'category' | 'tag') =>
  appError(
    'SITE_BLOG_TERM_NOT_FOUND',
    kind === 'category' ? 'Categoria não encontrada' : 'Tag não encontrada',
  )

const slugTaken = (kind: 'category' | 'tag') =>
  appError(
    'SITE_BLOG_TERM_SLUG_TAKEN',
    kind === 'category'
      ? 'Já existe uma categoria com este endereço'
      : 'Já existe uma tag com este endereço',
  )

const withCount = { _count: { select: { posts: true } } } as const

export const SiteBlogTermRepository = {
  async listCategories(
    siteId: string,
  ): Promise<Result<SiteBlogCategoryWithCount[]>> {
    try {
      return ok(
        await prisma.siteBlogCategory.findMany({
          where: { siteId },
          include: withCount,
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list blog categories', error))
    }
  },

  async findCategory(
    id: string,
    siteId: string,
  ): Promise<Result<SiteBlogCategoryWithCount>> {
    try {
      const category = await prisma.siteBlogCategory.findFirst({
        where: { id, siteId },
        include: withCount,
      })
      return category ? ok(category) : err(termNotFound('category'))
    } catch (error) {
      return err(dbError('Failed to find blog category', error))
    }
  },

  async findCategoryBySlug(
    siteId: string,
    slug: string,
  ): Promise<Result<SiteBlogCategory | null>> {
    try {
      return ok(
        await prisma.siteBlogCategory.findFirst({ where: { siteId, slug } }),
      )
    } catch (error) {
      return err(dbError('Failed to find blog category', error))
    }
  },

  async countCategories(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteBlogCategory.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count blog categories', error))
    }
  },

  async createCategory(data: {
    siteId: string
    name: string
    slug: string
    description?: string | null
    position: number
  }): Promise<Result<SiteBlogCategoryWithCount>> {
    try {
      return ok(
        await prisma.siteBlogCategory.create({ data, include: withCount }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken('category'))
      return err(dbError('Failed to create blog category', error))
    }
  },

  async updateCategory(
    id: string,
    data: Prisma.SiteBlogCategoryUpdateInput,
  ): Promise<Result<SiteBlogCategoryWithCount>> {
    try {
      return ok(
        await prisma.siteBlogCategory.update({
          where: { id },
          data,
          include: withCount,
        }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken('category'))
      return err(dbError('Failed to update blog category', error))
    }
  },

  async deleteCategory(id: string): Promise<Result<void>> {
    try {
      await prisma.siteBlogCategory.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete blog category', error))
    }
  },

  async listTags(siteId: string): Promise<Result<SiteBlogTagWithCount[]>> {
    try {
      return ok(
        await prisma.siteBlogTag.findMany({
          where: { siteId },
          include: withCount,
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list blog tags', error))
    }
  },

  async findTag(
    id: string,
    siteId: string,
  ): Promise<Result<SiteBlogTagWithCount>> {
    try {
      const tag = await prisma.siteBlogTag.findFirst({
        where: { id, siteId },
        include: withCount,
      })
      return tag ? ok(tag) : err(termNotFound('tag'))
    } catch (error) {
      return err(dbError('Failed to find blog tag', error))
    }
  },

  async countTags(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteBlogTag.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count blog tags', error))
    }
  },

  async createTag(data: {
    siteId: string
    name: string
    slug: string
  }): Promise<Result<SiteBlogTagWithCount>> {
    try {
      return ok(await prisma.siteBlogTag.create({ data, include: withCount }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken('tag'))
      return err(dbError('Failed to create blog tag', error))
    }
  },

  /** Tags by slug, created when missing (post editor's "new tag"). */
  async upsertTags(
    siteId: string,
    tags: Array<{ name: string; slug: string }>,
  ): Promise<Result<SiteBlogTag[]>> {
    try {
      const rows = await prisma.$transaction(
        tags.map((tag) =>
          prisma.siteBlogTag.upsert({
            where: { siteId_slug: { siteId, slug: tag.slug } },
            create: { siteId, name: tag.name, slug: tag.slug },
            update: {},
          }),
        ),
      )
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to upsert blog tags', error))
    }
  },

  async updateTag(
    id: string,
    data: Prisma.SiteBlogTagUpdateInput,
  ): Promise<Result<SiteBlogTagWithCount>> {
    try {
      return ok(
        await prisma.siteBlogTag.update({
          where: { id },
          data,
          include: withCount,
        }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken('tag'))
      return err(dbError('Failed to update blog tag', error))
    }
  },

  async deleteTag(id: string): Promise<Result<void>> {
    try {
      await prisma.siteBlogTag.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete blog tag', error))
    }
  },

  /** How many of `categoryIds`/`tagIds` belong to the site (ownership of
   * the ids a post is linked to). */
  async countOwned(
    siteId: string,
    categoryIds: string[],
    tagIds: string[],
  ): Promise<Result<{ categories: number; tags: number }>> {
    try {
      const [categories, tags] = await prisma.$transaction([
        prisma.siteBlogCategory.count({
          where: { siteId, id: { in: categoryIds } },
        }),
        prisma.siteBlogTag.count({ where: { siteId, id: { in: tagIds } } }),
      ])
      return ok({ categories, tags })
    } catch (error) {
      return err(dbError('Failed to check blog terms', error))
    }
  },
}
