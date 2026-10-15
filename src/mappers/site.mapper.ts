import type { Site, SiteGlobal, SitePage, SiteVersion } from '@prisma/client'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { parseSiteSettings } from '@/src/schemas/site.schema'
import { parseSitePageSeo } from '@/src/schemas/site-page.schema'
import type {
  SiteDTO,
  SiteGlobalDTO,
  SitePageDTO,
  SitePageSummaryDTO,
  SiteSummaryDTO,
  SiteVersionDTO,
} from '@/types/site'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function toSiteDTO(site: Site, url: string): SiteDTO {
  return {
    id: site.id,
    workspaceId: site.workspaceId,
    name: site.name,
    slug: site.slug,
    status: site.status,
    theme: asRecord(site.theme),
    settings: parseSiteSettings(site.settings),
    homePageId: site.homePageId,
    publishedVersionId: site.publishedVersionId,
    publishedAt: site.publishedAt ? site.publishedAt.toISOString() : null,
    url,
    sourceLandingPageId: site.sourceLandingPageId,
    createdById: site.createdById,
    updatedById: site.updatedById,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  }
}

export function toSiteSummaryDTO(
  site: Site & { _count: { pages: number } },
  url: string,
): SiteSummaryDTO {
  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    status: site.status,
    url,
    pageCount: site._count.pages,
    publishedAt: site.publishedAt ? site.publishedAt.toISOString() : null,
    updatedAt: site.updatedAt.toISOString(),
  }
}

export function toSitePageSummaryDTO(
  page: Omit<SitePage, 'document'>,
): SitePageSummaryDTO {
  return {
    id: page.id,
    siteId: page.siteId,
    parentId: page.parentId,
    title: page.title,
    slug: page.slug,
    path: page.path,
    position: page.position,
    isHome: page.isHome,
    seo: parseSitePageSeo(page.seo),
    updatedAt: page.updatedAt.toISOString(),
  }
}

export function toSitePageDTO(page: SitePage): SitePageDTO {
  return {
    ...toSitePageSummaryDTO(page),
    document: page.document as unknown as CanvasDocument,
    createdAt: page.createdAt.toISOString(),
  }
}

export function toSiteGlobalDTO(global: SiteGlobal): SiteGlobalDTO {
  return {
    id: global.id,
    siteId: global.siteId,
    kind: global.kind,
    name: global.name,
    document: global.document as unknown as CanvasDocument,
    createdAt: global.createdAt.toISOString(),
    updatedAt: global.updatedAt.toISOString(),
  }
}

export function toSiteVersionDTO(
  version: Pick<
    SiteVersion,
    'id' | 'siteId' | 'number' | 'publishedById' | 'createdAt'
  > & { publishedBy?: { name: string | null } | null },
  liveVersionId: string | null,
): SiteVersionDTO {
  return {
    id: version.id,
    siteId: version.siteId,
    number: version.number,
    publishedById: version.publishedById,
    publishedByName: version.publishedBy?.name ?? null,
    isLive: version.id === liveVersionId,
    createdAt: version.createdAt.toISOString(),
  }
}
