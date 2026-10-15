import type { SiteCollectionListProps, SitePostListProps } from './schemas-cms'

/**
 * Dynamic content of a site page (blog and collections): what the blog and
 * collection elements render, resolved before the render (the public
 * runtime from the database, the editor from sample data) and handed in
 * through `SiteRenderContext.cms`. Plain data with formatted labels, so the
 * components stay pure and render the same on the server and in the
 * canvas.
 */

export interface SiteCmsTermLink {
  id: string
  name: string
  slug: string
  href: string
  description?: string | null
  /** Published posts in the term. */
  count?: number
}

export interface SiteCmsAuthorSocial {
  network: string
  url: string
}

export interface SiteCmsAuthor {
  id: string
  name: string
  slug: string
  href: string
  avatarUrl?: string | null
  bio?: string | null
  links?: SiteCmsAuthorSocial[]
}

export interface SiteCmsPostCard {
  id: string
  title: string
  slug: string
  href: string
  excerpt: string
  coverUrl?: string | null
  coverAlt?: string | null
  /** ISO date (`<time datetime>`). */
  publishedAt: string
  /** Date formatted in the site's timezone (`15 de outubro de 2026`). */
  dateLabel: string
  readingMinutes: number
  featured: boolean
  categories: SiteCmsTermLink[]
  tags: SiteCmsTermLink[]
  author?: SiteCmsAuthor | null
}

export interface SiteCmsPost extends SiteCmsPostCard {
  /** Sanitized body HTML (see `plateToHtml`). */
  html: string
  updatedAt: string
  updatedLabel: string
  /** FAQ of the post (rendered as an accordion + FAQPage JSON-LD). */
  faq: Array<{ question: string; answer: string }>
}

export interface SiteCmsPageLink {
  page: number
  href: string
}

/** Posts of one `site.post-list` (already filtered and paginated). */
export interface SiteCmsPostList {
  posts: SiteCmsPostCard[]
  page: number
  pageCount: number
  total: number
  prevHref?: string
  nextHref?: string
  pages: SiteCmsPageLink[]
}

/** The archive a dynamic blog page shows (index, term, author, search). */
export interface SiteCmsArchive {
  kind: 'index' | 'category' | 'tag' | 'author' | 'search'
  title: string
  description?: string | null
}

export const SITE_CMS_FIELD_TYPES = [
  'text',
  'richtext',
  'image',
  'number',
  'date',
  'link',
  'reference',
  'product',
] as const
export type SiteCmsFieldType = (typeof SITE_CMS_FIELD_TYPES)[number]

/** A field value ready to render. */
export interface SiteCmsValue {
  type: SiteCmsFieldType
  /** Display text (formatted number/date, link label, product name…). */
  text: string
  /** Sanitized HTML (`richtext`). */
  html?: string
  /** Image/link/reference target. */
  url?: string
  alt?: string
}

export interface SiteCmsItem {
  id: string
  title: string
  slug: string
  /** Public URL when the collection has an item template. */
  href?: string
  values: Record<string, SiteCmsValue>
}

export interface SiteCmsCollectionList {
  collectionName: string
  items: SiteCmsItem[]
}

export interface SiteCmsContext {
  /** Public URL of the blog index (`/blog`). */
  blogHref: string
  archive?: SiteCmsArchive
  /** Search term of a blog search page. */
  query?: string
  /** Post of a single-post page. */
  post?: SiteCmsPost
  /** Author of an author page. */
  author?: SiteCmsAuthor
  /** Related posts of the current post. */
  related?: SiteCmsPostCard[]
  /** Post lists by node id. */
  lists?: Record<string, SiteCmsPostList>
  categories?: SiteCmsTermLink[]
  tags?: SiteCmsTermLink[]
  /** Collection lists by node id. */
  collections?: Record<string, SiteCmsCollectionList>
  /** Item of a collection item page. */
  item?: SiteCmsItem
  /** Editor canvas with sample content (empty states read differently). */
  sample?: boolean
  /** Editor: computes a post list from the node's live props (the runtime
   * precomputes `lists` instead). */
  postList?: (nodeId: string, props: SitePostListProps) => SiteCmsPostList
  /** Editor: computes a collection list from the node's live props. */
  collectionList?: (
    nodeId: string,
    props: SiteCollectionListProps,
  ) => SiteCmsCollectionList | undefined
}
