import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { ok, type Result } from '@/src/lib/result'
import { parseCollectionFields } from '@/src/lib/sites/blog/collections'
import type { BlogData, CollectionRecord } from '@/src/lib/sites/blog/resolve'
import { sampleBlogData, samplePostBody } from '@/src/lib/sites/blog/sample'
import {
  BLOG_TEMPLATE_KEYS,
  defaultBlogTemplate,
} from '@/src/lib/sites/blog/templates'
import { toSiteGlobalDTO } from '@/src/mappers/site.mapper'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import { SiteCollectionRepository } from '@/src/repositories/site-collection.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePostRepository } from '@/src/repositories/site-post.repository'
import {
  parseAuthorLinks,
  parseSitePostSeo,
  postFaqOf,
} from '@/src/schemas/site-blog.schema'
import type { SiteGlobalDTO } from '@/types/site'
import type { SiteCmsPreviewDTO } from '@/types/site-blog'
import { authorizeSite } from './site-access'
import { toPostRecord } from './site-blog-public.service'

/**
 * Blog setup of a site in the editor: the dynamic page templates (TEMPLATE
 * globals, published with the site) and the data the canvas renders the
 * blog/collection elements with.
 */

/** Posts the editor canvas previews (newest edits first). */
const PREVIEW_POSTS = 50

export const SiteBlogService = {
  /** Creates the blog templates the site does not have yet (index, post,
   * category, tag, author) from the built-in defaults; returns all of
   * them. Idempotent. */
  async ensureTemplates(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteGlobalDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const globals = await SiteGlobalRepository.listBySite(siteId)
    if (!globals.ok) return globals
    const existing = new Map(
      globals.value
        .filter((global) => global.kind === 'TEMPLATE')
        .map((global) => [global.name, global]),
    )
    const created: string[] = []
    for (const key of BLOG_TEMPLATE_KEYS) {
      if (existing.has(key)) continue
      const global = await SiteGlobalRepository.create({
        siteId,
        kind: 'TEMPLATE',
        name: key,
        document: defaultBlogTemplate(key) as unknown as Prisma.InputJsonValue,
      })
      if (!global.ok) return global
      existing.set(key, global.value)
      created.push(key)
    }
    if (created.length) {
      auditMutation({
        entity: 'site_global',
        action: 'create',
        actorId,
        targetId: siteId,
        meta: { siteId, templates: created },
      })
    }
    return ok(
      BLOG_TEMPLATE_KEYS.map((key) => existing.get(key))
        .filter((global) => global !== undefined)
        .map(toSiteGlobalDTO),
    )
  },

  /**
   * Data of the editor canvas: the site's posts (any status, so templates
   * can be designed with drafts), terms, authors and collection items.
   * With no post at all it returns the sample blog.
   */
  async preview(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteCmsPreviewDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const [posts, categories, tags, authors, collections] = await Promise.all([
      SitePostRepository.list(siteId, { page: 1, pageSize: PREVIEW_POSTS }),
      SiteBlogTermRepository.listCategories(siteId),
      SiteBlogTermRepository.listTags(siteId),
      SiteAuthorRepository.list(siteId),
      SiteCollectionRepository.list(siteId),
    ])
    if (!posts.ok) return posts
    if (!categories.ok) return categories
    if (!tags.ok) return tags
    if (!authors.ok) return authors
    if (!collections.ok) return collections

    const records: Record<string, CollectionRecord> = {}
    for (const collection of collections.value) {
      const items = await SiteCollectionRepository.listItems(collection.id)
      if (!items.ok) return items
      records[collection.id] = {
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
        fields: parseCollectionFields(collection.fields),
        hasTemplate: Boolean(collection.templateGlobalId),
        items: items.value.map((item) => ({
          id: item.id,
          title: item.title,
          slug: item.slug,
          data: (item.data ?? {}) as Record<string, unknown>,
          position: item.position,
          publishedAt: (item.publishedAt ?? item.createdAt).toISOString(),
        })),
      }
    }

    if (posts.value.items.length === 0) {
      const blog = sampleBlogData()
      return ok({
        blog,
        collections: records,
        post: { ...blog.posts[0], ...samplePostBody() },
        sample: true,
      })
    }

    const blog: BlogData = {
      posts: posts.value.items.map((post) =>
        toPostRecord({
          ...post,
          // Drafts have no date yet: preview them as if published now.
          publishedAt: post.publishedAt ?? post.updatedAt,
          categories: post.categories.map((entry) => ({
            categoryId: entry.category.id,
          })),
          tags: post.tags.map((entry) => ({ tagId: entry.tag.id })),
        }),
      ),
      categories: categories.value.map((term) => ({
        id: term.id,
        name: term.name,
        slug: term.slug,
        description: term.description,
      })),
      tags: tags.value.map((term) => ({
        id: term.id,
        name: term.name,
        slug: term.slug,
      })),
      authors: authors.value.map((author) => ({
        id: author.id,
        name: author.name,
        slug: author.slug,
        bio: author.bio,
        avatarUrl: author.avatarUrl,
        links: parseAuthorLinks(author.links),
      })),
    }
    const first = posts.value.items[0]
    return ok({
      blog,
      collections: records,
      post: {
        ...blog.posts[0],
        html: first.contentHtml,
        faq: postFaqOf(parseSitePostSeo(first.seo)),
      },
      sample: false,
    })
  },
}
