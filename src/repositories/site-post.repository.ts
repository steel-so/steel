import type { Prisma, SitePost, SitePostStatus } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/**
 * Blog posts of a site (slice site-blog). Pure data access: the service
 * owns authorization, slugs, rendering and the publication rules.
 */

const postInclude = {
  author: { select: { id: true, name: true, slug: true } },
  categories: {
    select: { category: { select: { id: true, name: true, slug: true } } },
  },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.SitePostInclude

export type SitePostWithRelations = Prisma.SitePostGetPayload<{
  include: typeof postInclude
}>

/** Live posts (published, or scheduled and already due). */
export function livePostWhere(
  siteId: string,
  now: Date,
): Prisma.SitePostWhereInput {
  return {
    siteId,
    status: { in: ['PUBLISHED', 'SCHEDULED'] },
    publishedAt: { lte: now },
  }
}

const cardSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverImageUrl: true,
  coverImageAlt: true,
  publishedAt: true,
  updatedAt: true,
  readingMinutes: true,
  featured: true,
  authorId: true,
  seo: true,
  autoExcerpt: true,
  categories: { select: { categoryId: true } },
  tags: { select: { tagId: true } },
} satisfies Prisma.SitePostSelect

export type SitePostCardRow = Prisma.SitePostGetPayload<{
  select: typeof cardSelect
}>

const liveInclude = {
  categories: { select: { categoryId: true } },
  tags: { select: { tagId: true } },
} satisfies Prisma.SitePostInclude

export type SitePostLiveRow = Prisma.SitePostGetPayload<{
  include: typeof liveInclude
}>

const slugTaken = () =>
  appError('SITE_POST_SLUG_TAKEN', 'Já existe um post com este endereço')

const notFound = () => appError('SITE_POST_NOT_FOUND', 'Post não encontrado')

export interface SitePostFilters {
  status?: SitePostStatus
  categoryId?: string
  tagId?: string
  authorId?: string
  search?: string
  page: number
  pageSize: number
}

export interface SitePostWriteData {
  title?: string
  slug?: string
  excerpt?: string | null
  content?: Prisma.InputJsonValue
  contentHtml?: string
  plainText?: string
  autoExcerpt?: string
  coverImageUrl?: string | null
  coverImageAlt?: string | null
  authorId?: string | null
  status?: SitePostStatus
  featured?: boolean
  publishedAt?: Date | null
  wordCount?: number
  readingMinutes?: number
  seo?: Prisma.InputJsonValue
  updatedById?: string
}

function relationWrites(categoryIds?: string[], tagIds?: string[]) {
  return {
    ...(categoryIds
      ? {
          categories: {
            deleteMany: {},
            create: categoryIds.map((categoryId) => ({ categoryId })),
          },
        }
      : {}),
    ...(tagIds
      ? {
          tags: {
            deleteMany: {},
            create: tagIds.map((tagId) => ({ tagId })),
          },
        }
      : {}),
  }
}

export const SitePostRepository = {
  async list(
    siteId: string,
    filters: SitePostFilters,
  ): Promise<Result<{ items: SitePostWithRelations[]; total: number }>> {
    const where: Prisma.SitePostWhereInput = {
      siteId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.authorId ? { authorId: filters.authorId } : {}),
      ...(filters.categoryId
        ? { categories: { some: { categoryId: filters.categoryId } } }
        : {}),
      ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: 'insensitive' } },
              { excerpt: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    try {
      const [items, total] = await prisma.$transaction([
        prisma.sitePost.findMany({
          where,
          include: postInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.sitePost.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list site posts', error))
    }
  },

  async findById(
    id: string,
    siteId: string,
  ): Promise<Result<SitePostWithRelations>> {
    try {
      const post = await prisma.sitePost.findFirst({
        where: { id, siteId },
        include: postInclude,
      })
      return post ? ok(post) : err(notFound())
    } catch (error) {
      return err(dbError('Failed to find site post', error))
    }
  },

  /** Posts among `ids` that belong to the site. */
  async findManyByIds(
    siteId: string,
    ids: string[],
  ): Promise<Result<SitePost[]>> {
    try {
      return ok(
        await prisma.sitePost.findMany({ where: { siteId, id: { in: ids } } }),
      )
    } catch (error) {
      return err(dbError('Failed to find site posts', error))
    }
  },

  /** Slugs of the site starting with `base` (free slug lookup). */
  async slugsLike(
    siteId: string,
    base: string,
    excludeId?: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.sitePost.findMany({
        where: {
          siteId,
          slug: { startsWith: base },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { slug: true },
      })
      return ok(rows.map((row) => row.slug))
    } catch (error) {
      return err(dbError('Failed to list site post slugs', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.sitePost.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site posts', error))
    }
  },

  async create(
    data: SitePostWriteData & {
      siteId: string
      title: string
      slug: string
      createdById: string
    },
    relations: { categoryIds?: string[]; tagIds?: string[] } = {},
  ): Promise<Result<SitePostWithRelations>> {
    try {
      const post = await prisma.sitePost.create({
        data: {
          ...data,
          ...(relations.categoryIds?.length
            ? {
                categories: {
                  create: relations.categoryIds.map((categoryId) => ({
                    categoryId,
                  })),
                },
              }
            : {}),
          ...(relations.tagIds?.length
            ? {
                tags: {
                  create: relations.tagIds.map((tagId) => ({ tagId })),
                },
              }
            : {}),
        },
        include: postInclude,
      })
      return ok(post)
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken())
      return err(dbError('Failed to create site post', error))
    }
  },

  async update(
    id: string,
    data: SitePostWriteData,
    relations: { categoryIds?: string[]; tagIds?: string[] } = {},
  ): Promise<Result<SitePostWithRelations>> {
    try {
      const post = await prisma.sitePost.update({
        where: { id },
        data: {
          ...data,
          ...relationWrites(relations.categoryIds, relations.tagIds),
        },
        include: postInclude,
      })
      return ok(post)
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken())
      return err(dbError('Failed to update site post', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.sitePost.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site post', error))
    }
  },

  async deleteMany(siteId: string, ids: string[]): Promise<Result<number>> {
    try {
      const result = await prisma.sitePost.deleteMany({
        where: { siteId, id: { in: ids } },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to delete site posts', error))
    }
  },

  async updateMany(
    siteId: string,
    ids: string[],
    data: {
      status?: SitePostStatus
      featured?: boolean
      publishedAt?: Date
      updatedById?: string
    },
  ): Promise<Result<number>> {
    try {
      const result = await prisma.sitePost.updateMany({
        where: { siteId, id: { in: ids } },
        data,
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to update site posts', error))
    }
  },

  /** Publishes drafts among `ids` now, keeping the date of posts that had
   * one (scheduled ones keep theirs and stay scheduled). */
  async publishMany(
    siteId: string,
    ids: string[],
    now: Date,
    updatedById: string,
  ): Promise<Result<number>> {
    try {
      const [dated, undated] = await prisma.$transaction([
        prisma.sitePost.updateMany({
          where: {
            siteId,
            id: { in: ids },
            status: 'DRAFT',
            publishedAt: { lte: now },
          },
          data: { status: 'PUBLISHED', updatedById },
        }),
        prisma.sitePost.updateMany({
          where: {
            siteId,
            id: { in: ids },
            status: 'DRAFT',
            OR: [{ publishedAt: null }, { publishedAt: { gt: now } }],
          },
          data: { status: 'PUBLISHED', publishedAt: now, updatedById },
        }),
      ])
      return ok(dated.count + undated.count)
    } catch (error) {
      return err(dbError('Failed to publish site posts', error))
    }
  },

  async setCategory(
    ids: string[],
    categoryId: string,
    present: boolean,
  ): Promise<Result<number>> {
    try {
      if (present) {
        const result = await prisma.sitePostCategory.createMany({
          data: ids.map((postId) => ({ postId, categoryId })),
          skipDuplicates: true,
        })
        return ok(result.count)
      }
      const result = await prisma.sitePostCategory.deleteMany({
        where: { postId: { in: ids }, categoryId },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to change post categories', error))
    }
  },

  /** Live posts of a site as cards (runtime lists, sitemap), newest first. */
  async listLiveCards(
    siteId: string,
    now: Date,
    limit: number,
  ): Promise<Result<SitePostCardRow[]>> {
    try {
      return ok(
        await prisma.sitePost.findMany({
          where: livePostWhere(siteId, now),
          select: cardSelect,
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list live site posts', error))
    }
  },

  /** Ids of live posts whose title, excerpt or body contain every word
   * (blog search page). */
  async searchLiveIds(
    siteId: string,
    words: string[],
    now: Date,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.sitePost.findMany({
        where: {
          ...livePostWhere(siteId, now),
          AND: words.map((word) => ({
            OR: [
              { title: { contains: word, mode: 'insensitive' as const } },
              { excerpt: { contains: word, mode: 'insensitive' as const } },
              { plainText: { contains: word, mode: 'insensitive' as const } },
            ],
          })),
        },
        select: { id: true },
        orderBy: { publishedAt: 'desc' },
        take: limit,
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to search site posts', error))
    }
  },

  /** A live post by slug, with its body (single-post page). */
  async findLiveBySlug(
    siteId: string,
    slug: string,
    now: Date,
  ): Promise<Result<SitePostLiveRow | null>> {
    try {
      return ok(
        await prisma.sitePost.findFirst({
          where: { ...livePostWhere(siteId, now), slug },
          include: liveInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find live site post', error))
    }
  },

  /** Live posts with their bodies (feeds), optionally of one category. */
  async listLiveForFeed(
    siteId: string,
    now: Date,
    limit: number,
    categoryId?: string,
  ): Promise<Result<SitePostWithRelations[]>> {
    try {
      return ok(
        await prisma.sitePost.findMany({
          where: {
            ...livePostWhere(siteId, now),
            ...(categoryId ? { categories: { some: { categoryId } } } : {}),
          },
          include: postInclude,
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site feed posts', error))
    }
  },

  /** Scheduled posts whose date arrived, with their site slug. */
  async listDue(
    now: Date,
    limit: number,
  ): Promise<Result<Array<{ id: string; site: { slug: string } }>>> {
    try {
      return ok(
        await prisma.sitePost.findMany({
          where: { status: 'SCHEDULED', publishedAt: { lte: now } },
          select: { id: true, site: { select: { slug: true } } },
          orderBy: { publishedAt: 'asc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list due site posts', error))
    }
  },

  async markPublished(ids: string[]): Promise<Result<number>> {
    try {
      const result = await prisma.sitePost.updateMany({
        where: { id: { in: ids }, status: 'SCHEDULED' },
        data: { status: 'PUBLISHED' },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to publish due site posts', error))
    }
  },
}
