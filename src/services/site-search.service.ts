import type { Prisma, Site, SiteGlobal, SitePage } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { sitePageUrl } from '@/src/lib/sites/host'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import {
  analyzeSearchPage,
  buildSearchReport,
} from '@/src/lib/sites/search/analyze'
import { profileCompleteness } from '@/src/lib/sites/search/business'
import { extractPageContent } from '@/src/lib/sites/search/content'
import {
  isEmptyProfile,
  searchSettingsOf,
  suggestBusinessProfile,
} from '@/src/lib/sites/search/context'
import {
  generateIndexNowKey,
  INDEXNOW_KEY_PATH,
} from '@/src/lib/sites/search/indexnow'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { parseSiteSettings } from '@/src/schemas/site.schema'
import { parseSitePageSeo } from '@/src/schemas/site-page.schema'
import {
  parseSearchContent,
  type SearchApplyDTO,
  type SiteSearchSettingsDTO,
  type UpdateSiteSearchSettingsDTO,
} from '@/src/schemas/site-search.schema'
import type {
  SiteSearchReportDTO,
  SiteSearchSettingsViewDTO,
} from '@/types/site-search'
import { authorizeSite } from './site-access'

/**
 * "Buscadores" of a site: the site-level settings (business profile,
 * crawlers, llms.txt, IndexNow, verification), the "Saúde nos buscadores"
 * report over the draft pages, and applying reviewed AI suggestions. The
 * settings live in `sites.settings.search` and, like every other setting,
 * reach the public site on the next publish.
 */

const json = (value: unknown) => value as Prisma.InputJsonValue

const pageNotFound = () =>
  appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada')

/** Readable text of the header and footer (NAP consistency). */
export function chromeTextOf(globals: SiteGlobal[]): string {
  return globals
    .filter((global) => global.kind === 'HEADER' || global.kind === 'FOOTER')
    .map(
      (global) =>
        extractPageContent(global.document as unknown as CanvasDocument).text,
    )
    .join(' ')
}

/** Public path of a draft page (`''` is the home page). */
function draftPath(site: Site, page: Pick<SitePage, 'id' | 'path' | 'isHome'>) {
  const isHome = site.homePageId ? site.homePageId === page.id : page.isHome
  return isHome ? '' : page.path
}

function view(
  site: Site,
  settings: SiteSearchSettingsDTO,
  prefilled: boolean,
): SiteSearchSettingsViewDTO {
  const base = publicSiteUrl(site.slug)
  return {
    settings,
    prefilled,
    completeness: profileCompleteness(settings.business),
    published: site.status === 'PUBLISHED',
    urls: {
      robots: `${base}/robots.txt`,
      sitemap: `${base}/sitemap.xml`,
      llms: `${base}/llms.txt`,
      llmsFull: `${base}/llms-full.txt`,
      indexNowKey:
        settings.indexNow.enabled && settings.indexNow.key
          ? `${base}/${INDEXNOW_KEY_PATH}`
          : null,
    },
  }
}

export const SiteSearchService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteSearchSettingsViewDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const settings = parseSiteSettings(site.value.settings)
    const search = searchSettingsOf(settings)
    if (!isEmptyProfile(search.business)) {
      return ok(view(site.value, search, false))
    }

    // Never saved: a first draft from what the workspace already knows.
    const [workspace, brand] = await Promise.all([
      WorkspaceRepository.findById(workspaceId),
      CrmEmailBuilderRepository.findBrand(workspaceId),
    ])
    const business = suggestBusinessProfile({
      siteName: site.value.name,
      settings,
      workspace: workspace.ok ? workspace.value : null,
      brand: brand.ok ? brand.value : null,
    })
    return ok(view(site.value, { ...search, business }, true))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: UpdateSiteSearchSettingsDTO,
  ): Promise<Result<SiteSearchSettingsViewDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const settings = parseSiteSettings(site.value.settings)
    const current = searchSettingsOf(settings)
    const enableIndexNow = dto.indexNow?.enabled ?? current.indexNow.enabled
    const next: SiteSearchSettingsDTO = {
      business: dto.business ?? current.business,
      crawlers: dto.crawlers ?? current.crawlers,
      llms: dto.llms ?? current.llms,
      verification: dto.verification ?? current.verification,
      indexNow: {
        enabled: enableIndexNow,
        // The key is kept once generated, so turning IndexNow off and on
        // again does not invalidate what the engines already verified.
        ...(current.indexNow.key || enableIndexNow
          ? { key: current.indexNow.key ?? generateIndexNowKey() }
          : {}),
      },
    }

    const updated = await SiteRepository.update(siteId, {
      settings: json({ ...settings, search: next }),
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'site',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { scope: 'search', fields: Object.keys(dto) },
    })
    return ok(view(updated.value, next, false))
  },

  /** Scores of every draft page plus the issues ranked by impact. */
  async report(
    actorId: string,
    workspaceId: string,
    siteId: string,
    now: Date = new Date(),
  ): Promise<Result<SiteSearchReportDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const [pages, globals] = await Promise.all([
      SitePageRepository.listWithDocuments(siteId),
      SiteGlobalRepository.listBySite(siteId),
    ])
    if (!pages.ok) return pages
    if (!globals.ok) return globals

    const settings = parseSiteSettings(site.value.settings)
    const base = publicSiteUrl(site.value.slug)
    const chromeText = chromeTextOf(globals.value)
    const summaries = pages.value.map((page) => ({
      id: page.id,
      title: page.title,
      seo: parseSitePageSeo(page.seo),
    }))

    const analyzed = pages.value.map((page) => {
      const path = draftPath(site.value, page)
      return {
        id: page.id,
        title: page.title,
        path: `/${path}`,
        analysis: analyzeSearchPage({
          page: {
            id: page.id,
            title: page.title,
            slug: page.slug,
            isHome: path === '',
            seo: parseSitePageSeo(page.seo),
            updatedAt: page.updatedAt.toISOString(),
          },
          document: page.document as unknown as CanvasDocument,
          site: {
            name: site.value.name,
            settings,
            pageUrl: sitePageUrl(base, path),
          },
          siblings: summaries.filter((other) => other.id !== page.id),
          chromeText,
          now,
        }),
      }
    })

    return ok({
      ...buildSearchReport(analyzed),
      generatedAt: now.toISOString(),
      completeness: profileCompleteness(searchSettingsOf(settings).business),
    })
  },

  /** Applies reviewed AI suggestions: title, description and answers of the
   * page's questions (matched by question text; new ones are appended). */
  async apply(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: SearchApplyDTO,
  ): Promise<Result<{ updated: string[] }>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const pages = await SitePageRepository.listBySite(siteId)
    if (!pages.ok) return pages
    const byId = new Map(pages.value.map((page) => [page.id, page]))
    if (dto.items.some((item) => !byId.has(item.pageId))) {
      return err(pageNotFound())
    }

    const updated: string[] = []
    for (const item of dto.items) {
      const page = byId.get(item.pageId) as (typeof pages.value)[number]
      const seo = parseSitePageSeo(page.seo)
      const search = parseSearchContent(seo.search)
      let questions = search.questions
      if (item.questions) {
        const merged = [...(search.questions ?? [])]
        for (const incoming of item.questions) {
          const key = incoming.question.trim().toLowerCase()
          const index = merged.findIndex(
            (existing) => existing.question.trim().toLowerCase() === key,
          )
          if (index >= 0)
            merged[index] = { ...merged[index], answer: incoming.answer }
          else merged.push(incoming)
        }
        questions = merged.slice(0, 20)
      }
      const next = {
        ...seo,
        ...(item.title ? { title: item.title } : {}),
        ...(item.description ? { description: item.description } : {}),
        search: { ...search, ...(questions ? { questions } : {}) },
      }
      const saved = await SitePageRepository.update(page.id, {
        seo: json(next),
      })
      if (!saved.ok) return saved
      updated.push(page.id)
    }

    auditMutation({
      entity: 'site_page',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { scope: 'search-ai-apply', pages: updated },
    })
    return ok({ updated })
  },
}
