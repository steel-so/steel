import type { SiteCollection, SiteCollectionItem } from '@prisma/client'
import { ok, type Result } from '@/src/lib/result'
import {
  itemSummary,
  parseCollectionFields,
} from '@/src/lib/sites/blog/collections'
import type { LlmsSection } from '@/src/lib/sites/blog/llms'
import type {
  BlogData,
  BlogPostBody,
  BlogPostRecord,
  CollectionRecord,
} from '@/src/lib/sites/blog/resolve'
import { normalizeSearch } from '@/src/lib/sites/blog/resolve'
import {
  BLOG_BASE,
  blogPath,
  collectionItemPath,
} from '@/src/lib/sites/blog/routes'
import { snapshotTemplateKeys } from '@/src/lib/sites/blog/runtime'
import {
  BLOG_TEMPLATE_KEYS,
  collectionTemplateKey,
} from '@/src/lib/sites/blog/templates'
import { sitePageUrl } from '@/src/lib/sites/host'
import type { SiteSnapshot } from '@/src/lib/sites/snapshot'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import { SiteCollectionRepository } from '@/src/repositories/site-collection.repository'
import {
  type SitePostCardRow,
  SitePostRepository,
  type SitePostWithRelations,
} from '@/src/repositories/site-post.repository'
import {
  parseAuthorLinks,
  parseSitePostSeo,
  postFaqOf,
  type SitePostSeoDTO,
} from '@/src/schemas/site-blog.schema'

/**
 * Public reads of the blog and collections (no session): the runtime calls
 * them after `SitePublicService.getPublished` proved the site is live.
 * Posts are live on their own (published, or scheduled and due); terms
 * and authors are listed when they have live posts.
 */

/** Cards loaded per site for the lists (newest first). */
export const BLOG_CARDS_LIMIT = 1000

export interface PublicBlogPost extends BlogPostRecord, BlogPostBody {
  seo: SitePostSeoDTO
  wordCount: number
}

export function toPostRecord(row: SitePostCardRow): BlogPostRecord {
  const excerpt = row.excerpt?.trim() || row.autoExcerpt
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt,
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    readingMinutes: row.readingMinutes,
    featured: row.featured,
    categoryIds: row.categories.map((entry) => entry.categoryId),
    tagIds: row.tags.map((entry) => entry.tagId),
    authorId: row.authorId,
    searchText: normalizeSearch(`${row.title} ${excerpt}`),
  }
}

function toCollectionRecord(
  collection: SiteCollection & { items: SiteCollectionItem[] },
  templateKeys: Set<string>,
): CollectionRecord {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    fields: parseCollectionFields(collection.fields),
    hasTemplate: templateKeys.has(collectionTemplateKey(collection.id)),
    items: collection.items.map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      data:
        typeof item.data === 'object' &&
        item.data !== null &&
        !Array.isArray(item.data)
          ? (item.data as Record<string, unknown>)
          : {},
      position: item.position,
      publishedAt: (item.publishedAt ?? item.createdAt).toISOString(),
    })),
  }
}

export const SiteBlogPublicService = {
  /** Live posts (cards), terms and authors of a site. */
  async blogData(siteId: string, now: Date): Promise<Result<BlogData>> {
    const [cards, categories, tags, authors] = await Promise.all([
      SitePostRepository.listLiveCards(siteId, now, BLOG_CARDS_LIMIT),
      SiteBlogTermRepository.listCategories(siteId),
      SiteBlogTermRepository.listTags(siteId),
      SiteAuthorRepository.list(siteId),
    ])
    if (!cards.ok) return cards
    if (!categories.ok) return categories
    if (!tags.ok) return tags
    if (!authors.ok) return authors
    return ok({
      posts: cards.value.map(toPostRecord),
      categories: categories.value.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
      })),
      tags: tags.value.map((tag) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
      })),
      authors: authors.value.map((author) => ({
        id: author.id,
        name: author.name,
        slug: author.slug,
        bio: author.bio,
        avatarUrl: author.avatarUrl,
        links: parseAuthorLinks(author.links),
      })),
    })
  },

  /** A live post with its body, by slug (`null` when there is none). */
  async post(
    siteId: string,
    slug: string,
    now: Date,
  ): Promise<Result<PublicBlogPost | null>> {
    const found = await SitePostRepository.findLiveBySlug(siteId, slug, now)
    if (!found.ok) return found
    const post = found.value
    if (!post) return ok(null)
    const seo = parseSitePostSeo(post.seo)
    const record = toPostRecord(post)
    return ok({
      ...record,
      html: post.contentHtml,
      faq: postFaqOf(seo),
      seo,
      wordCount: post.wordCount,
    })
  },

  /** Ids of live posts matching every word of `query` (title, excerpt or
   * body). */
  async search(
    siteId: string,
    query: string,
    now: Date,
  ): Promise<Result<string[]>> {
    const words = query.split(/\s+/).filter((word) => word.length > 1)
    if (words.length === 0) return ok([])
    return SitePostRepository.searchLiveIds(
      siteId,
      words.slice(0, 8),
      now,
      BLOG_CARDS_LIMIT,
    )
  },

  /** Published items of the site's collections (all, or `ids`), with
   * whether each collection has an item page in the snapshot. */
  async collections(
    siteId: string,
    templateKeys: Iterable<string>,
    ids?: string[],
  ): Promise<Result<Record<string, CollectionRecord>>> {
    const list = await SiteCollectionRepository.listPublished(siteId, ids)
    if (!list.ok) return list
    const keys = new Set(templateKeys)
    const out: Record<string, CollectionRecord> = {}
    for (const collection of list.value) {
      out[collection.id] = toCollectionRecord(collection, keys)
    }
    return ok(out)
  },

  /** Public paths of the dynamic pages (proxy route index): the blog and
   * its archives when it has live posts or templates, and the items of
   * collections that have an item page. */
  async routePaths(
    siteId: string,
    snapshot: SiteSnapshot,
    now: Date,
  ): Promise<Result<string[]>> {
    const [blog, collections] = await Promise.all([
      SiteBlogPublicService.blogData(siteId, now),
      SiteBlogPublicService.collections(siteId, snapshotTemplateKeys(snapshot)),
    ])
    if (!blog.ok) return blog
    if (!collections.ok) return collections
    const keys = snapshotTemplateKeys(snapshot)
    const paths: string[] = []
    const { posts, categories, tags, authors } = blog.value
    const hasBlogTemplate = BLOG_TEMPLATE_KEYS.some((key) => keys.has(key))
    if (posts.length > 0 || hasBlogTemplate) {
      paths.push(`/${BLOG_BASE}`)
      const used = (ids: string[][]) => new Set(ids.flat())
      const usedCategories = used(posts.map((post) => post.categoryIds))
      const usedTags = used(posts.map((post) => post.tagIds))
      const usedAuthors = new Set(posts.map((post) => post.authorId))
      for (const post of posts) {
        paths.push(blogPath({ kind: 'post', slug: post.slug }))
      }
      for (const term of categories) {
        if (usedCategories.has(term.id)) {
          paths.push(blogPath({ kind: 'category', slug: term.slug }))
        }
      }
      for (const term of tags) {
        if (usedTags.has(term.id)) {
          paths.push(blogPath({ kind: 'tag', slug: term.slug }))
        }
      }
      for (const author of authors) {
        if (usedAuthors.has(author.id)) {
          paths.push(blogPath({ kind: 'author', slug: author.slug }))
        }
      }
    }
    for (const collection of Object.values(collections.value)) {
      if (!collection.hasTemplate) continue
      for (const item of collection.items) {
        paths.push(collectionItemPath(collection.slug, item.slug))
      }
    }
    return ok(paths)
  },

  /** Live posts with bodies for a feed (whole blog or one category);
   * `null` when the category does not exist. */
  async feed(
    siteId: string,
    now: Date,
    limit: number,
    categorySlug?: string,
  ): Promise<
    Result<{ posts: SitePostWithRelations[]; category?: string } | null>
  > {
    let categoryId: string | undefined
    let categoryName: string | undefined
    if (categorySlug) {
      const category = await SiteBlogTermRepository.findCategoryBySlug(
        siteId,
        categorySlug,
      )
      if (!category.ok) return category
      if (!category.value) return ok(null)
      categoryId = category.value.id
      categoryName = category.value.name
    }
    const posts = await SitePostRepository.listLiveForFeed(
      siteId,
      now,
      limit,
      categoryId,
    )
    if (!posts.ok) return posts
    return ok({ posts: posts.value, category: categoryName })
  },

  /** Sitemap entries of the dynamic pages: posts (not noindex, canonical
   * on themselves), the blog index and collection items with a page. */
  async sitemap(
    siteId: string,
    snapshot: SiteSnapshot,
    now: Date,
  ): Promise<Result<Array<{ path: string; lastModified: Date }>>> {
    const [cards, collections] = await Promise.all([
      SitePostRepository.listLiveCards(siteId, now, BLOG_CARDS_LIMIT * 5),
      SiteBlogPublicService.collections(siteId, snapshotTemplateKeys(snapshot)),
    ])
    if (!cards.ok) return cards
    if (!collections.ok) return collections
    const entries: Array<{ path: string; lastModified: Date }> = []
    const indexable = cards.value.filter((row) => {
      const seo = parseSitePostSeo(row.seo)
      return !seo.noindex && !seo.canonicalUrl
    })
    if (cards.value.length > 0) {
      entries.push({
        path: `/${BLOG_BASE}`,
        lastModified: cards.value[0].updatedAt,
      })
    }
    for (const row of indexable) {
      entries.push({
        path: blogPath({ kind: 'post', slug: row.slug }),
        lastModified: row.updatedAt,
      })
    }
    for (const collection of Object.values(collections.value)) {
      if (!collection.hasTemplate) continue
      for (const item of collection.items) {
        entries.push({
          path: collectionItemPath(collection.slug, item.slug),
          lastModified: new Date(item.publishedAt),
        })
      }
    }
    return ok(entries)
  },

  /** `/llms.txt` sections of the dynamic content: the blog's posts and
   * the items of collections with a page (pass them to the llms.txt
   * renderer of the Buscadores area). */
  async llmsSections(
    siteId: string,
    snapshot: SiteSnapshot,
    baseUrl: string,
    now: Date,
  ): Promise<Result<LlmsSection[]>> {
    const [blog, collections] = await Promise.all([
      SiteBlogPublicService.blogData(siteId, now),
      SiteBlogPublicService.collections(siteId, snapshotTemplateKeys(snapshot)),
    ])
    if (!blog.ok) return blog
    if (!collections.ok) return collections
    const url = (path: string) => sitePageUrl(baseUrl, path.slice(1))
    const sections: LlmsSection[] = [
      {
        title: 'Blog',
        links: blog.value.posts.slice(0, 200).map((post) => ({
          title: post.title,
          url: url(blogPath({ kind: 'post', slug: post.slug })),
          summary: post.excerpt,
        })),
      },
    ]
    for (const collection of Object.values(collections.value)) {
      if (!collection.hasTemplate) continue
      sections.push({
        title: collection.name,
        links: collection.items.slice(0, 200).map((item) => ({
          title: item.title,
          url: url(collectionItemPath(collection.slug, item.slug)),
          summary: itemSummary(collection.fields, item.data, 160),
        })),
      })
    }
    return ok(sections)
  },
}
