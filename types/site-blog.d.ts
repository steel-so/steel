import type {
  BlogData,
  CollectionRecord,
} from '@/src/lib/sites/blog/resolve'
import type { PlateValue } from '@/src/lib/sites/blog/plate'
import type { CollectionField } from '@/src/lib/sites/blog/collections'
import type {
  SiteAuthorLinkDTO,
  SitePostSeoDTO,
  SitePostStatusDTO,
} from '@/src/schemas/site-blog.schema'

export interface SiteTermRefDTO {
  id: string
  name: string
  slug: string
}

/** Post row of the editor lists (no body). */
export interface SitePostSummaryDTO {
  id: string
  siteId: string
  title: string
  slug: string
  excerpt: string | null
  coverImageUrl: string | null
  status: SitePostStatusDTO
  featured: boolean
  publishedAt: string | null
  readingMinutes: number
  author: SiteTermRefDTO | null
  categories: SiteTermRefDTO[]
  tags: SiteTermRefDTO[]
  /** Site path of the post (`/blog/<slug>`). */
  path: string
  createdAt: string
  updatedAt: string
}

export interface SitePostDTO extends SitePostSummaryDTO {
  content: PlateValue
  coverImageAlt: string | null
  wordCount: number
  seo: SitePostSeoDTO
  createdById: string
  updatedById: string | null
}

export interface SitePostPageDTO {
  items: SitePostSummaryDTO[]
  total: number
  page: number
  pageSize: number
}

export interface SiteBlogCategoryDTO {
  id: string
  siteId: string
  name: string
  slug: string
  description: string | null
  position: number
  postCount: number
}

export interface SiteBlogTagDTO {
  id: string
  siteId: string
  name: string
  slug: string
  postCount: number
}

export interface SiteAuthorDTO {
  id: string
  siteId: string
  userId: string | null
  name: string
  slug: string
  bio: string | null
  avatarUrl: string | null
  links: SiteAuthorLinkDTO[]
  postCount: number
}

export interface SiteBulkPostsResultDTO {
  affected: number
}

export interface SiteCollectionDTO {
  id: string
  siteId: string
  name: string
  itemName: string
  slug: string
  fields: CollectionField[]
  templateGlobalId: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
}

export interface SiteCollectionItemDTO {
  id: string
  collectionId: string
  title: string
  slug: string
  data: Record<string, unknown>
  status: 'DRAFT' | 'PUBLISHED'
  position: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Result of an AI helper: always a draft the user reviews. */
export interface SiteBlogAiResultDTO {
  action: 'write' | 'summary' | 'titles' | 'faq'
  title?: string
  excerpt?: string
  description?: string
  content?: PlateValue
  titles?: string[]
  faq?: Array<{ question: string; answer: string }>
}

/** What the editor canvas renders blog/collection elements with. */
export interface SiteCmsPreviewDTO {
  blog: BlogData
  collections: Record<string, CollectionRecord>
  /** A post to show in the single-post template (newest one). */
  post: (BlogData['posts'][number] & { html: string; faq: Array<{ question: string; answer: string }> }) | null
  /** The site has no published post: the canvas shows sample posts. */
  sample: boolean
}
