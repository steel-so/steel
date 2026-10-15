import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'

export type SiteStatusDTO = 'DRAFT' | 'PUBLISHED'
export type SiteGlobalKindDTO = 'HEADER' | 'FOOTER' | 'SYMBOL'

export interface SiteDTO {
  id: string
  workspaceId: string
  name: string
  slug: string
  status: SiteStatusDTO
  theme: Record<string, unknown>
  settings: SiteSettingsDTO
  homePageId: string | null
  publishedVersionId: string | null
  publishedAt: string | null
  /** Public address (subdomain when `SITES_ROOT_DOMAIN` is set). */
  url: string
  /** Landing page this site was migrated from, if any. */
  sourceLandingPageId: string | null
  createdById: string
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** Site row of the list (no theme/settings payload). */
export interface SiteSummaryDTO {
  id: string
  name: string
  slug: string
  status: SiteStatusDTO
  url: string
  pageCount: number
  publishedAt: string | null
  updatedAt: string
}

/** Page without its document (lists, tree). */
export interface SitePageSummaryDTO {
  id: string
  siteId: string
  parentId: string | null
  title: string
  slug: string
  path: string
  position: number
  isHome: boolean
  seo: SitePageSeoDTO
  updatedAt: string
}

export interface SitePageDTO extends SitePageSummaryDTO {
  document: CanvasDocument
  createdAt: string
}

export interface SiteGlobalDTO {
  id: string
  siteId: string
  kind: SiteGlobalKindDTO
  name: string
  document: CanvasDocument
  createdAt: string
  updatedAt: string
}

export interface SiteVersionDTO {
  id: string
  siteId: string
  number: number
  publishedById: string | null
  publishedByName: string | null
  /** This is the version live on the public address. */
  isLive: boolean
  createdAt: string
}

export interface SiteLandingMigrationDTO {
  landingPageId: string
  siteId: string
  slug: string
  status: 'created' | 'skipped'
  published: boolean
}
