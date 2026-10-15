/**
 * Addresses of the dynamic pages of a site: the blog (`/blog`,
 * `/blog/<post>`, `/blog/categoria/<slug>`, `/blog/tag/<slug>`,
 * `/blog/autor/<slug>`) and collection items (`/<collection>/<item>`).
 * Page numbers and searches are query parameters (`?pagina=2`,
 * `?busca=termo`), so the path index of a site stays small.
 */

export const BLOG_BASE = 'blog'
export const BLOG_CATEGORY_SEGMENT = 'categoria'
export const BLOG_TAG_SEGMENT = 'tag'
export const BLOG_AUTHOR_SEGMENT = 'autor'
export const BLOG_PAGE_PARAM = 'pagina'
export const BLOG_SEARCH_PARAM = 'busca'
/** Site feeds (RSS 2.0 and Atom); `?categoria=<slug>` narrows them. */
export const SITE_FEED_PATHS = ['/feed.xml', '/atom.xml'] as const

/** Post slugs that would shadow an archive route. */
export const RESERVED_POST_SLUGS: ReadonlySet<string> = new Set([
  BLOG_CATEGORY_SEGMENT,
  BLOG_TAG_SEGMENT,
  BLOG_AUTHOR_SEGMENT,
  'feed',
  'pagina',
])

/** Collection slugs that would shadow the blog or the runtime's files. */
export const RESERVED_COLLECTION_SLUGS: ReadonlySet<string> = new Set([
  BLOG_BASE,
  'api',
  'media',
  's',
  '_og',
  '_next',
])

export type BlogRoute =
  | { kind: 'index' }
  | { kind: 'post'; slug: string }
  | { kind: 'category'; slug: string }
  | { kind: 'tag'; slug: string }
  | { kind: 'author'; slug: string }

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const ARCHIVE_SEGMENTS: Record<string, 'category' | 'tag' | 'author'> = {
  [BLOG_CATEGORY_SEGMENT]: 'category',
  [BLOG_TAG_SEGMENT]: 'tag',
  [BLOG_AUTHOR_SEGMENT]: 'author',
}

/** Blog route of a path (segments after the site), `null` when it is not
 * one. */
export function parseBlogRoute(segments: string[]): BlogRoute | null {
  const parts = segments.map((segment) => segment.toLowerCase())
  if (parts[0] !== BLOG_BASE) return null
  if (parts.length === 1) return { kind: 'index' }
  if (parts.length === 2) {
    return SLUG.test(parts[1]) && !RESERVED_POST_SLUGS.has(parts[1])
      ? { kind: 'post', slug: parts[1] }
      : null
  }
  const archive = ARCHIVE_SEGMENTS[parts[1]]
  if (parts.length === 3 && archive && SLUG.test(parts[2])) {
    return { kind: archive, slug: parts[2] }
  }
  return null
}

const ROUTE_PREFIX: Record<Exclude<BlogRoute['kind'], 'index'>, string> = {
  post: BLOG_BASE,
  category: `${BLOG_BASE}/${BLOG_CATEGORY_SEGMENT}`,
  tag: `${BLOG_BASE}/${BLOG_TAG_SEGMENT}`,
  author: `${BLOG_BASE}/${BLOG_AUTHOR_SEGMENT}`,
}

/** Site path of a blog route (`/blog/categoria/dicas`). */
export function blogPath(route: BlogRoute): string {
  if (route.kind === 'index') return `/${BLOG_BASE}`
  return `/${ROUTE_PREFIX[route.kind]}/${route.slug}`
}

/** `/<collection>/<item>` of a path, `null` for any other shape. */
export function parseCollectionRoute(
  segments: string[],
): { collectionSlug: string; itemSlug: string } | null {
  if (segments.length !== 2) return null
  const [collectionSlug, itemSlug] = segments.map((segment) =>
    segment.toLowerCase(),
  )
  if (!SLUG.test(collectionSlug) || !SLUG.test(itemSlug)) return null
  if (RESERVED_COLLECTION_SLUGS.has(collectionSlug)) return null
  return { collectionSlug, itemSlug }
}

export function collectionItemPath(
  collectionSlug: string,
  itemSlug: string,
): string {
  return `/${collectionSlug}/${itemSlug}`
}

/** Page number of `?pagina=` (1 when absent or invalid). */
export function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const page = Number(raw)
  return Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1
}

/** Search term of `?busca=` (trimmed, capped, empty when absent). */
export function searchTerm(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
}

/** `path` with query parameters (empty values and page 1 are left out). */
export function withQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    if (key === BLOG_PAGE_PARAM && Number(value) <= 1) continue
    query.set(key, String(value))
  }
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/** First slug not in `used`: `base`, `base-2`, `base-3`… */
export function firstFreeSlug(
  base: string,
  used: Iterable<string>,
  maxLength = 80,
): string {
  const taken = new Set(used)
  for (let attempt = 1; attempt <= 500; attempt++) {
    const suffix = attempt === 1 ? '' : `-${attempt}`
    const slug = `${base.slice(0, maxLength - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!taken.has(slug)) return slug
  }
  return `${base.slice(0, maxLength - 9)}-${Date.now().toString(36)}`
}
