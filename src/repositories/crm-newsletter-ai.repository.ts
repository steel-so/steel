import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Sources the newsletter AI may read (newsletter2 nl2-digest-ai): live
 * blog posts of the workspace sites, published ServiceDesk KB articles
 * visible in the portal (internal ones never go into a newsletter) and
 * active CRM products. Lists return only titles; the `find*` reads
 * return the text of the ids the member picked — always scoped to the
 * workspace, so a foreign id is simply not found.
 */

export type AiPostRow = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  autoExcerpt: string
  plainText: string
  coverImageUrl: string | null
  publishedAt: Date | null
  site: { name: string; slug: string; publishedAt: Date | null }
}

export type AiKbRow = { id: string; title: string; plainText: string }

export type AiProductRow = {
  id: string
  name: string
  description: string | null
  unitPrice: { toString(): string }
  currency: string
}

const livePost = (workspaceId: string, now: Date) => ({
  status: { in: ['PUBLISHED' as const, 'SCHEDULED' as const] },
  publishedAt: { lte: now },
  site: { workspaceId, deletedAt: null },
})

export const CrmNewsletterAiRepository = {
  async listRecentPosts(
    workspaceId: string,
    now: Date,
    limit = 20,
  ): Promise<
    Result<
      {
        id: string
        title: string
        publishedAt: Date | null
        site: { name: string }
      }[]
    >
  > {
    try {
      const posts = await prisma.sitePost.findMany({
        where: livePost(workspaceId, now),
        select: {
          id: true,
          title: true,
          publishedAt: true,
          site: { select: { name: true } },
        },
        orderBy: { publishedAt: 'desc' },
        take: limit,
      })
      return ok(posts)
    } catch (error) {
      return err(dbError('Failed to list posts for the newsletter AI', error))
    }
  },

  async findPosts(
    workspaceId: string,
    ids: string[],
    now: Date,
  ): Promise<Result<AiPostRow[]>> {
    if (ids.length === 0) return ok([])
    try {
      const posts = await prisma.sitePost.findMany({
        where: { id: { in: ids }, ...livePost(workspaceId, now) },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          autoExcerpt: true,
          plainText: true,
          coverImageUrl: true,
          publishedAt: true,
          site: { select: { name: true, slug: true, publishedAt: true } },
        },
        orderBy: { publishedAt: 'desc' },
      })
      return ok(posts)
    } catch (error) {
      return err(dbError('Failed to read posts for the newsletter AI', error))
    }
  },

  async listKbArticles(
    workspaceId: string,
    limit = 30,
  ): Promise<Result<{ id: string; title: string }[]>> {
    try {
      const articles = await prisma.sdKbArticle.findMany({
        where: {
          workspaceId,
          status: 'PUBLISHED',
          visibility: 'PORTAL',
          archivedAt: null,
        },
        select: { id: true, title: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })
      return ok(articles)
    } catch (error) {
      return err(
        dbError('Failed to list KB articles for the newsletter AI', error),
      )
    }
  },

  async findKbArticles(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<AiKbRow[]>> {
    if (ids.length === 0) return ok([])
    try {
      const articles = await prisma.sdKbArticle.findMany({
        where: {
          id: { in: ids },
          workspaceId,
          status: 'PUBLISHED',
          visibility: 'PORTAL',
          archivedAt: null,
        },
        select: { id: true, title: true, plainText: true },
      })
      return ok(articles)
    } catch (error) {
      return err(
        dbError('Failed to read KB articles for the newsletter AI', error),
      )
    }
  },

  async listProducts(
    workspaceId: string,
    limit = 50,
  ): Promise<Result<{ id: string; name: string }[]>> {
    try {
      const products = await prisma.crmProduct.findMany({
        where: { workspaceId, active: true, deletedAt: null },
        select: { id: true, name: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        take: limit,
      })
      return ok(products)
    } catch (error) {
      return err(
        dbError('Failed to list products for the newsletter AI', error),
      )
    }
  },

  async findProducts(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<AiProductRow[]>> {
    if (ids.length === 0) return ok([])
    try {
      const products = await prisma.crmProduct.findMany({
        where: { id: { in: ids }, workspaceId, active: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          description: true,
          unitPrice: true,
          currency: true,
        },
      })
      return ok(products)
    } catch (error) {
      return err(
        dbError('Failed to read products for the newsletter AI', error),
      )
    }
  },
}
