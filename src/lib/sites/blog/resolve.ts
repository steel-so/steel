import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type {
  SiteCmsArchive,
  SiteCmsAuthor,
  SiteCmsContext,
  SiteCmsItem,
  SiteCmsPageLink,
  SiteCmsPost,
  SiteCmsPostCard,
  SiteCmsPostList,
  SiteCmsTermLink,
} from '@/src/lib/canvas-site/cms'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import type {
  SiteCollectionListProps,
  SitePostListProps,
} from '@/src/lib/canvas-site/schemas-cms'
import { type CollectionField, formatItemValues } from './collections'
import { formatSiteDate } from './format'
import {
  BLOG_PAGE_PARAM,
  BLOG_SEARCH_PARAM,
  type BlogRoute,
  blogPath,
  collectionItemPath,
  withQuery,
} from './routes'

/**
 * Turns the blog and collection data of a site into what the elements of
 * one page render (`SiteCmsContext`): each post list filtered, ordered and
 * paginated, the archive of the route, the current post/item, the term
 * lists and the collection lists. Shared by the public runtime (data from
 * the database) and the editor canvas (sample data), so both show the
 * same thing. Pure.
 */

export interface BlogPostRecord {
  id: string
  title: string
  slug: string
  excerpt: string
  coverImageUrl: string | null
  coverImageAlt: string | null
  /** ISO date. */
  publishedAt: string
  updatedAt: string
  readingMinutes: number
  featured: boolean
  categoryIds: string[]
  tagIds: string[]
  authorId: string | null
  /** Lower-case, accent-free text searched by the blog search. */
  searchText: string
}

export interface BlogPostBody {
  html: string
  faq: Array<{ question: string; answer: string }>
}

export interface BlogTermRecord {
  id: string
  name: string
  slug: string
  description?: string | null
}

export interface BlogAuthorRecord {
  id: string
  name: string
  slug: string
  bio?: string | null
  avatarUrl?: string | null
  links?: Array<{ network: string; url: string }>
}

/** Published blog content of a site (posts newest first). */
export interface BlogData {
  posts: BlogPostRecord[]
  categories: BlogTermRecord[]
  tags: BlogTermRecord[]
  authors: BlogAuthorRecord[]
}

export interface CollectionItemRecord {
  id: string
  title: string
  slug: string
  data: Record<string, unknown>
  position: number
  publishedAt: string
}

export interface CollectionRecord {
  id: string
  name: string
  slug: string
  fields: CollectionField[]
  /** Items have their own page (the collection has an item template). */
  hasTemplate: boolean
  /** Published items. */
  items: CollectionItemRecord[]
}

export interface CmsRequest {
  /** Site path being rendered (`/`, `/blog/categoria/dicas`). */
  path: string
  blogRoute: BlogRoute | null
  page: number
  query: string
  /** Ids of the posts matching `query` (the runtime searches the bodies
   * in the database); without it the search matches title and excerpt. */
  searchIds?: string[]
  /** Body of the post a single-post page shows. */
  post?: BlogPostRecord & BlogPostBody
  /** Item a collection item page shows. */
  item?: { collectionId: string; itemId: string }
}

export interface ResolveCmsInput {
  docs: CanvasDocument[]
  blog?: BlogData | null
  collections?: Record<string, CollectionRecord>
  request: CmsRequest
  /** Site path → link (adds `/s/<slug>` on the app domain). */
  href: (path: string) => string
  timezone?: string
  sample?: boolean
}

type CmsInput = Omit<ResolveCmsInput, 'docs'>

/** Lower-case, accent-free text (search). */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every word of `query` appears in the post. */
export function matchesSearch(post: BlogPostRecord, query: string): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  return words.every((word) => post.searchText.includes(word))
}

/** Nodes of the documents (visible ones). */
function visibleNodes(docs: CanvasDocument[]): CanvasNode[] {
  const out: CanvasNode[] = []
  for (const doc of docs) {
    const stack = [doc.rootId]
    while (stack.length) {
      const node = getNode(doc, stack.pop() as string)
      if (!node || node.meta?.hidden) continue
      out.push(node)
      stack.push(...(node.children ?? []))
    }
  }
  return out
}

const BLOG_TYPES = new Set<string>([
  SITE_TYPES.postList,
  SITE_TYPES.post,
  SITE_TYPES.postTerms,
  SITE_TYPES.blogSearch,
  SITE_TYPES.postAuthor,
])

/** What the documents need loaded: blog data, and which collections. */
export function cmsNeeds(docs: CanvasDocument[]): {
  blog: boolean
  collectionIds: string[]
  itemFields: boolean
} {
  let blog = false
  let itemFields = false
  const ids = new Set<string>()
  for (const node of visibleNodes(docs)) {
    if (BLOG_TYPES.has(node.type)) blog = true
    if (node.type === SITE_TYPES.collectionField) itemFields = true
    if (node.type === SITE_TYPES.collectionList) {
      const id = node.props.collectionId
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  return { blog, collectionIds: [...ids], itemFields }
}

interface Lookups {
  categories: Map<string, SiteCmsTermLink>
  tags: Map<string, SiteCmsTermLink>
  authors: Map<string, SiteCmsAuthor>
}

function lookups(blog: BlogData, href: CmsInput['href']): Lookups {
  const counts = new Map<string, number>()
  for (const post of blog.posts) {
    for (const id of [...post.categoryIds, ...post.tagIds]) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const term =
    (kind: 'category' | 'tag') =>
    (record: BlogTermRecord): [string, SiteCmsTermLink] => [
      record.id,
      {
        id: record.id,
        name: record.name,
        slug: record.slug,
        description: record.description ?? null,
        href: href(blogPath({ kind, slug: record.slug })),
        count: counts.get(record.id) ?? 0,
      },
    ]
  return {
    categories: new Map(blog.categories.map(term('category'))),
    tags: new Map(blog.tags.map(term('tag'))),
    authors: new Map(
      blog.authors.map((author) => [
        author.id,
        {
          id: author.id,
          name: author.name,
          slug: author.slug,
          href: href(blogPath({ kind: 'author', slug: author.slug })),
          avatarUrl: author.avatarUrl ?? null,
          bio: author.bio ?? null,
          links: author.links ?? [],
        },
      ]),
    ),
  }
}

function toCard(
  post: BlogPostRecord,
  maps: Lookups,
  input: CmsInput,
): SiteCmsPostCard {
  const pick = (ids: string[], map: Map<string, SiteCmsTermLink>) =>
    ids
      .map((id) => map.get(id))
      .filter((term): term is SiteCmsTermLink => term !== undefined)
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    href: input.href(blogPath({ kind: 'post', slug: post.slug })),
    excerpt: post.excerpt,
    coverUrl: post.coverImageUrl,
    coverAlt: post.coverImageAlt,
    publishedAt: post.publishedAt,
    dateLabel: formatSiteDate(post.publishedAt, input.timezone),
    readingMinutes: post.readingMinutes,
    featured: post.featured,
    categories: pick(post.categoryIds, maps.categories),
    tags: pick(post.tagIds, maps.tags),
    author: post.authorId ? (maps.authors.get(post.authorId) ?? null) : null,
  }
}

function findTerm(
  records: BlogTermRecord[],
  slug: string | undefined,
): BlogTermRecord | undefined {
  return slug ? records.find((record) => record.slug === slug) : undefined
}

/** Posts of the current archive (route + search). */
function archivePosts(blog: BlogData, request: CmsRequest): BlogPostRecord[] {
  const route = request.blogRoute
  let posts = blog.posts
  if (route?.kind === 'category') {
    const id = findTerm(blog.categories, route.slug)?.id
    posts = posts.filter((post) => !!id && post.categoryIds.includes(id))
  } else if (route?.kind === 'tag') {
    const id = findTerm(blog.tags, route.slug)?.id
    posts = posts.filter((post) => !!id && post.tagIds.includes(id))
  } else if (route?.kind === 'author') {
    const id = blog.authors.find((author) => author.slug === route.slug)?.id
    posts = posts.filter((post) => !!id && post.authorId === id)
  }
  if (request.query) {
    const ids = request.searchIds ? new Set(request.searchIds) : null
    posts = posts.filter((post) =>
      ids ? ids.has(post.id) : matchesSearch(post, request.query),
    )
  }
  return posts
}

/** Posts sharing categories (2 points) and tags (1 point) with `current`,
 * best first, then the newest others to fill the list. */
export function relatedPosts(
  posts: BlogPostRecord[],
  current: Pick<BlogPostRecord, 'id' | 'categoryIds' | 'tagIds'>,
  limit: number,
): BlogPostRecord[] {
  const scored = posts
    .filter((post) => post.id !== current.id)
    .map((post, index) => ({
      post,
      index,
      score:
        post.categoryIds.filter((id) => current.categoryIds.includes(id))
          .length *
          2 +
        post.tagIds.filter((id) => current.tagIds.includes(id)).length,
    }))
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.post)
}

/** Page links: all pages up to 7, else first, last and a window around
 * the current one. */
export function pageWindow(page: number, pageCount: number): number[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  return [...pages]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b)
}

export function paginate<T>(
  items: T[],
  perPage: number,
  page: number,
): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * perPage
  return {
    items: items.slice(start, start + perPage),
    page: current,
    pageCount,
  }
}

function postList(
  props: SitePostListProps,
  blog: BlogData,
  maps: Lookups,
  input: CmsInput,
): SiteCmsPostList {
  const { request } = input
  let posts: BlogPostRecord[]
  switch (props.source) {
    case 'archive':
      posts = archivePosts(blog, request)
      break
    case 'featured':
      posts = blog.posts.filter((post) => post.featured)
      break
    case 'related':
      posts = request.post
        ? relatedPosts(blog.posts, request.post, props.perPage)
        : blog.posts
      break
    default:
      posts = blog.posts
  }
  const category = findTerm(blog.categories, props.categorySlug || undefined)
  if (props.categorySlug) {
    posts = posts.filter(
      (post) => !!category && post.categoryIds.includes(category.id),
    )
  }
  const tag = findTerm(blog.tags, props.tagSlug || undefined)
  if (props.tagSlug) {
    posts = posts.filter((post) => !!tag && post.tagIds.includes(tag.id))
  }
  const paged = paginate(
    posts,
    props.perPage,
    props.pagination ? request.page : 1,
  )
  const link = (page: number) =>
    input.href(
      withQuery(request.path, {
        [BLOG_SEARCH_PARAM]: request.query || undefined,
        [BLOG_PAGE_PARAM]: page,
      }),
    )
  const pages: SiteCmsPageLink[] = props.pagination
    ? pageWindow(paged.page, paged.pageCount).map((page) => ({
        page,
        href: link(page),
      }))
    : []
  return {
    posts: paged.items.map((post) => toCard(post, maps, input)),
    page: paged.page,
    pageCount: props.pagination ? paged.pageCount : 1,
    total: posts.length,
    prevHref:
      props.pagination && paged.page > 1 ? link(paged.page - 1) : undefined,
    nextHref:
      props.pagination && paged.page < paged.pageCount
        ? link(paged.page + 1)
        : undefined,
    pages,
  }
}

function archiveOf(
  blog: BlogData,
  request: CmsRequest,
  maps: Lookups,
): SiteCmsArchive | undefined {
  const route = request.blogRoute
  if (request.query) {
    return { kind: 'search', title: `Resultados para “${request.query}”` }
  }
  if (!route) return undefined
  switch (route.kind) {
    case 'category': {
      const term = findTerm(blog.categories, route.slug)
      return term
        ? { kind: 'category', title: term.name, description: term.description }
        : undefined
    }
    case 'tag': {
      const term = findTerm(blog.tags, route.slug)
      return term ? { kind: 'tag', title: `#${term.name}` } : undefined
    }
    case 'author': {
      const author = blog.authors.find((item) => item.slug === route.slug)
      const link = author ? maps.authors.get(author.id) : undefined
      return link
        ? {
            kind: 'author',
            title: `Posts de ${link.name}`,
            description: link.bio,
          }
        : undefined
    }
    case 'index':
      return { kind: 'index', title: 'Blog' }
    default:
      return undefined
  }
}

function sortItems(
  items: CollectionItemRecord[],
  sort: SiteCollectionListProps['sort'],
): CollectionItemRecord[] {
  const list = [...items]
  if (sort === 'newest') {
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  } else if (sort === 'title') {
    list.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  } else {
    list.sort((a, b) => a.position - b.position)
  }
  return list
}

function itemHref(
  collection: CollectionRecord,
  item: CollectionItemRecord,
  input: CmsInput,
): string | undefined {
  return collection.hasTemplate
    ? input.href(collectionItemPath(collection.slug, item.slug))
    : undefined
}

function referenceMap(
  collections: Record<string, CollectionRecord>,
  input: CmsInput,
): Map<string, { title: string; href?: string }> {
  const map = new Map<string, { title: string; href?: string }>()
  for (const collection of Object.values(collections)) {
    for (const item of collection.items) {
      map.set(item.id, {
        title: item.title,
        href: itemHref(collection, item, input),
      })
    }
  }
  return map
}

function toItem(
  collection: CollectionRecord,
  item: CollectionItemRecord,
  input: CmsInput,
  references: Map<string, { title: string; href?: string }>,
): SiteCmsItem {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    href: itemHref(collection, item, input),
    values: formatItemValues(collection.fields, item.data, {
      timezone: input.timezone,
      references,
    }),
  }
}

/**
 * The blog/collection context without the per-node lists: the archive,
 * current post/item, term lists, plus `postList`/`collectionList`, which
 * compute one list from a node's props. The editor canvas uses it as is
 * (lists follow the inspector live); `resolveCms` precomputes the lists of
 * a page for the public runtime.
 */
export function cmsResolver(
  input: Omit<ResolveCmsInput, 'docs'>,
): SiteCmsContext {
  const { request } = input
  const cms: SiteCmsContext = {
    blogHref: input.href(blogPath({ kind: 'index' })),
    query: request.query || undefined,
    sample: input.sample || undefined,
  }

  const blog = input.blog
  if (blog) {
    const maps = lookups(blog, input.href)
    cms.archive = archiveOf(blog, request, maps)
    cms.categories = [...maps.categories.values()].filter(
      (term) => (term.count ?? 0) > 0 || input.sample,
    )
    cms.tags = [...maps.tags.values()].filter(
      (term) => (term.count ?? 0) > 0 || input.sample,
    )
    if (request.blogRoute?.kind === 'author') {
      const slug = request.blogRoute.slug
      const author = blog.authors.find((item) => item.slug === slug)
      cms.author = author ? maps.authors.get(author.id) : undefined
    }
    if (request.post) {
      const card = toCard(request.post, maps, input)
      const post: SiteCmsPost = {
        ...card,
        html: request.post.html,
        faq: request.post.faq,
        updatedAt: request.post.updatedAt,
        updatedLabel: formatSiteDate(request.post.updatedAt, input.timezone),
      }
      cms.post = post
    }
    cms.postList = (_nodeId, props) => postList(props, blog, maps, input)
  }

  const collections = input.collections ?? {}
  const references = referenceMap(collections, input)
  cms.collectionList = (_nodeId, props) => {
    const collection = collections[props.collectionId]
    if (!collection) return undefined
    return {
      collectionName: collection.name,
      items: sortItems(collection.items, props.sort)
        .slice(0, props.limit)
        .map((item) => toItem(collection, item, input, references)),
    }
  }

  if (request.item) {
    const collection = collections[request.item.collectionId]
    const item = collection?.items.find(
      (entry) => entry.id === request.item?.itemId,
    )
    if (collection && item) {
      cms.item = toItem(collection, item, input, references)
    }
  }
  return cms
}

/** The page's `SiteCmsContext` (`undefined` when it shows no dynamic
 * content), with every list of the page precomputed. */
export function resolveCms(input: ResolveCmsInput): SiteCmsContext | undefined {
  const { request } = input
  const needs = cmsNeeds(input.docs)
  if (!needs.blog && needs.collectionIds.length === 0 && !request.item) {
    return request.blogRoute !== null || request.query
      ? { blogHref: input.href(blogPath({ kind: 'index' })) }
      : undefined
  }
  const {
    postList: listOf,
    collectionList: collectionOf,
    ...cms
  } = cmsResolver(input)
  const lists: Record<string, SiteCmsPostList> = {}
  const collectionLists: NonNullable<SiteCmsContext['collections']> = {}
  for (const node of visibleNodes(input.docs)) {
    if (node.type === SITE_TYPES.postList && listOf) {
      lists[node.id] = listOf(node.id, node.props as SitePostListProps)
    }
    if (node.type === SITE_TYPES.collectionList && collectionOf) {
      const list = collectionOf(node.id, node.props as SiteCollectionListProps)
      if (list) collectionLists[node.id] = list
    }
  }
  return {
    ...cms,
    ...(input.blog ? { lists } : {}),
    collections: collectionLists,
  }
}
