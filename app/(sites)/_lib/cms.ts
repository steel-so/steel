import { cacheLife, cacheTag } from 'next/cache'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SiteCmsContext } from '@/src/lib/canvas-site/cms'
import { itemSummary } from '@/src/lib/sites/blog/collections'
import { postJsonLd } from '@/src/lib/sites/blog/jsonld'
import {
  type BlogData,
  type CollectionRecord,
  cmsNeeds,
  resolveCms,
} from '@/src/lib/sites/blog/resolve'
import {
  BLOG_PAGE_PARAM,
  type BlogRoute,
  blogPath,
  collectionItemPath,
  parseBlogRoute,
  parseCollectionRoute,
  withQuery,
} from '@/src/lib/sites/blog/routes'
import {
  snapshotTemplateKeys,
  templateDocument,
  virtualPage,
} from '@/src/lib/sites/blog/runtime'
import {
  BLOG_TEMPLATE_KEYS,
  collectionTemplateKey,
} from '@/src/lib/sites/blog/templates'
import { siteCacheTag } from '@/src/lib/sites/cache'
import { resolveSiteHref, sitePageUrl } from '@/src/lib/sites/host'
import { absoluteUrl } from '@/src/lib/sites/seo'
import type { SiteSnapshotPage } from '@/src/lib/sites/snapshot'
import {
  type PublicBlogPost,
  SiteBlogPublicService,
} from '@/src/services/site-blog-public.service'
import type { PublishedSite } from '@/src/services/site-public.service'

/**
 * Dynamic pages of a published site (slice site-blog): blog index, posts,
 * category/tag/author archives and collection items, rendered with their
 * template (a TEMPLATE global of the snapshot, or the built-in default).
 * Reads are cached with the site's tag (a post change expires it) and a
 * short life (a scheduled post goes live by itself within minutes).
 */

type JsonLdNode = Record<string, unknown>

async function loadBlogData(
  slug: string,
  siteId: string,
): Promise<BlogData | null> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await SiteBlogPublicService.blogData(siteId, new Date())
  return result.ok ? result.value : null
}

async function loadBlogPost(
  slug: string,
  siteId: string,
  postSlug: string,
): Promise<PublicBlogPost | null> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await SiteBlogPublicService.post(siteId, postSlug, new Date())
  return result.ok ? result.value : null
}

async function loadBlogSearch(
  slug: string,
  siteId: string,
  query: string,
): Promise<string[]> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await SiteBlogPublicService.search(siteId, query, new Date())
  return result.ok ? result.value : []
}

async function loadCollections(
  slug: string,
  siteId: string,
  templateKeys: string[],
): Promise<Record<string, CollectionRecord>> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await SiteBlogPublicService.collections(siteId, templateKeys)
  return result.ok ? result.value : {}
}

function templateKeysOf(site: PublishedSite): string[] {
  return [...snapshotTemplateKeys(site.snapshot)].sort()
}

/** A dynamic page resolved from its path. */
export interface DynamicPage {
  page: SiteSnapshotPage
  route: BlogRoute | null
  post?: PublicBlogPost
  item?: { collectionId: string; itemId: string }
  /** Extra schema.org nodes (BlogPosting, FAQPage). */
  jsonLd: JsonLdNode[]
}

export interface DynamicRequest {
  page: number
  query: string
}

function pageSeo(
  site: PublishedSite,
  path: string,
  request: DynamicRequest,
  description?: string | null,
) {
  // Search results are not indexed; page 2+ is its own canonical.
  return {
    ...(description ? { description } : {}),
    ...(request.query ? { noindex: true } : {}),
    ...(request.page > 1
      ? {
          canonicalUrl: `${site.baseUrl}${withQuery(path, {
            [BLOG_PAGE_PARAM]: request.page,
          })}`,
        }
      : {}),
  }
}

/** The dynamic page at `segments`, or `null` (a real 404). */
export async function resolveDynamicPage(
  site: PublishedSite,
  segments: string[],
  request: DynamicRequest,
): Promise<DynamicPage | null> {
  const { snapshot } = site
  const route = parseBlogRoute(segments)
  if (route) {
    const blog = await loadBlogData(site.slug, site.id)
    if (!blog) return null
    const keys = snapshotTemplateKeys(snapshot)
    const path = blogPath(route)
    switch (route.kind) {
      case 'index': {
        const enabled =
          blog.posts.length > 0 || BLOG_TEMPLATE_KEYS.some((k) => keys.has(k))
        if (!enabled) return null
        return {
          route,
          jsonLd: [],
          page: virtualPage({
            id: 'blog:index',
            title: 'Blog',
            path: path.slice(1),
            seo: pageSeo(site, path, request),
            document: templateDocument(
              snapshot,
              'blog-index',
            ) as CanvasDocument,
          }),
        }
      }
      case 'post': {
        const post = await loadBlogPost(site.slug, site.id, route.slug)
        if (!post) return null
        const url =
          post.seo.canonicalUrl ?? sitePageUrl(site.baseUrl, path.slice(1))
        const author = blog.authors.find((item) => item.id === post.authorId)
        const cover = post.seo.socialImageUrl || post.coverImageUrl
        return {
          route,
          post,
          page: virtualPage({
            id: `post:${post.id}`,
            title: post.title,
            path: path.slice(1),
            seo: {
              title: post.seo.title,
              description: post.seo.description || post.excerpt,
              socialImageUrl: cover ?? undefined,
              noindex: post.seo.noindex,
              canonicalUrl: post.seo.canonicalUrl,
            },
            document: templateDocument(snapshot, 'blog-post') as CanvasDocument,
          }),
          jsonLd: postJsonLd({
            url,
            siteUrl: `${site.baseUrl}/`,
            headline: post.seo.title || post.title,
            description: post.seo.description || post.excerpt,
            imageUrl: cover ? absoluteUrl(cover, site.baseUrl) : undefined,
            publishedAt: post.publishedAt,
            updatedAt: post.updatedAt,
            wordCount: post.wordCount,
            author: author
              ? {
                  name: author.name,
                  url: sitePageUrl(
                    site.baseUrl,
                    blogPath({ kind: 'author', slug: author.slug }).slice(1),
                  ),
                }
              : null,
            keywords: blog.tags
              .filter((tag) => post.tagIds.includes(tag.id))
              .map((tag) => tag.name),
            section: blog.categories.find((category) =>
              post.categoryIds.includes(category.id),
            )?.name,
            focusKeyword: post.seo.search?.focusKeyword,
            faq: post.faq,
          }),
        }
      }
      default: {
        const kind = route.kind
        const term =
          kind === 'category'
            ? blog.categories.find((item) => item.slug === route.slug)
            : kind === 'tag'
              ? blog.tags.find((item) => item.slug === route.slug)
              : blog.authors.find((item) => item.slug === route.slug)
        if (!term) return null
        const description =
          'description' in term
            ? term.description
            : 'bio' in term
              ? term.bio
              : undefined
        const key =
          kind === 'category'
            ? 'blog-category'
            : kind === 'tag'
              ? 'blog-tag'
              : 'blog-author'
        return {
          route,
          jsonLd: [],
          page: virtualPage({
            id: `${kind}:${term.id}`,
            title: kind === 'tag' ? `#${term.name}` : term.name,
            path: path.slice(1),
            seo: pageSeo(site, path, request, description),
            document: templateDocument(snapshot, key) as CanvasDocument,
          }),
        }
      }
    }
  }

  const itemRoute = parseCollectionRoute(segments)
  if (!itemRoute) return null
  const collections = await loadCollections(
    site.slug,
    site.id,
    templateKeysOf(site),
  )
  const collection = Object.values(collections).find(
    (entry) => entry.slug === itemRoute.collectionSlug,
  )
  if (!collection?.hasTemplate) return null
  const item = collection.items.find(
    (entry) => entry.slug === itemRoute.itemSlug,
  )
  const document = templateDocument(
    snapshot,
    collectionTemplateKey(collection.id),
  )
  if (!item || !document) return null
  const path = collectionItemPath(collection.slug, item.slug)
  return {
    route: null,
    item: { collectionId: collection.id, itemId: item.id },
    jsonLd: [],
    page: virtualPage({
      id: `item:${item.id}`,
      title: item.title,
      path: path.slice(1),
      seo: { description: itemSummary(collection.fields, item.data, 300) },
      document,
    }),
  }
}

/** Blog/collection content of a page (`undefined` when it shows none). */
export async function siteCmsContext(
  site: PublishedSite,
  docs: CanvasDocument[],
  input: {
    /** Site path rendered (`/`, `/blog`). */
    path: string
    dynamic: DynamicPage | null
    request: DynamicRequest
    linkBase: string
  },
): Promise<SiteCmsContext | undefined> {
  const needs = cmsNeeds(docs)
  const { dynamic, request } = input
  const needsCollections =
    needs.collectionIds.length > 0 || needs.itemFields || !!dynamic?.item
  if (!needs.blog && !needsCollections && !dynamic?.route) return undefined
  const [blog, collections, searchIds] = await Promise.all([
    needs.blog || dynamic?.route
      ? loadBlogData(site.slug, site.id)
      : Promise.resolve(null),
    needsCollections
      ? loadCollections(site.slug, site.id, templateKeysOf(site))
      : Promise.resolve({}),
    request.query
      ? loadBlogSearch(site.slug, site.id, request.query)
      : Promise.resolve(undefined),
  ])
  return resolveCms({
    docs,
    blog,
    collections,
    request: {
      path: input.path,
      blogRoute: dynamic?.route ?? null,
      page: request.page,
      query: request.query,
      searchIds,
      post: dynamic?.post,
      item: dynamic?.item,
    },
    href: (path) => resolveSiteHref(path, input.linkBase),
    timezone: site.snapshot.settings.timezone,
  })
}
