import type {
  Site,
  SiteGlobal,
  SitePage,
  SiteSeoSnapshot,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { buildSearchReport } from '@/src/lib/sites/search/analyze'
import { extractPageContent } from '@/src/lib/sites/search/content'
import { renderedTitle, searchSettingsOf } from '@/src/lib/sites/search/context'
import {
  analyzeKeyword,
  brokenLinks,
  buildTechnicalChecklist,
  cleanKeyword,
  overallScore,
  snapshotDay,
  type TechnicalItemDTO,
  technicalSummary,
  worstPages,
} from '@/src/lib/sites/search/seo-overview'
import { normalizeText } from '@/src/lib/sites/search/text'
import { parseSiteSnapshot } from '@/src/lib/sites/snapshot'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { SiteSeoRepository } from '@/src/repositories/site-seo.repository'
import { parseSiteSettings } from '@/src/schemas/site.schema'
import { parseSitePageSeo } from '@/src/schemas/site-page.schema'
import { parseSearchContent } from '@/src/schemas/site-search.schema'
import {
  type CreateSeoKeywordDTO,
  MAX_SEO_KEYWORDS_PER_SITE,
} from '@/src/schemas/site-seo.schema'
import type {
  SiteSeoCardDTO,
  SiteSeoDetailDTO,
  SiteSeoHistoryPointDTO,
  SiteSeoKeywordDTO,
  SiteSeoOverviewDTO,
  SiteSeoReindexDTO,
} from '@/types/site-seo'
import { assertSitesPermission, authorizeSite } from './site-access'
import { SiteIndexNowService } from './site-indexnow.service'
import { analyzeSiteDraft } from './site-search.service'

/**
 * CRM > SEO: one screen over the "Buscadores" data of every site of the
 * workspace. Scores come from the same analysis as the site editor; this
 * service adds the daily history, the tracked keywords, the aggregated
 * technical checklist and a manual IndexNow ping.
 *
 * Ranking in Google needs Search Console (OAuth, needs Google approval) and
 * is not implemented: see `docs` and the "Posição no Google" section.
 */

export const HISTORY_OVERVIEW_DAYS = 30
export const HISTORY_DETAIL_DAYS = 90
/** Snapshots older than this are pruned by the daily job. */
export const SNAPSHOT_RETENTION_DAYS = 400
/** Sites analyzed at the same time (each loads every page document). */
const SITE_CONCURRENCY = 4
const DAY_MS = 86_400_000

const dayKey = (date: Date) => date.toISOString().slice(0, 10)

function pointOf(snapshot: SiteSeoSnapshot): SiteSeoHistoryPointDTO {
  return {
    day: dayKey(snapshot.day),
    seo: snapshot.seo,
    aeo: snapshot.aeo,
    geo: snapshot.geo,
    overall: overallScore(snapshot),
    issues: snapshot.issues,
  }
}

interface SiteAnalysis {
  site: Site
  pages: SitePage[]
  globals: SiteGlobal[]
  analyzed: ReturnType<typeof analyzeSiteDraft>
  report: ReturnType<typeof buildSearchReport>
  issueCount: number
}

async function analyzeSite(
  site: Site,
  now: Date,
): Promise<Result<SiteAnalysis>> {
  const [pages, globals] = await Promise.all([
    SitePageRepository.listWithDocuments(site.id),
    SiteGlobalRepository.listBySite(site.id),
  ])
  if (!pages.ok) return pages
  if (!globals.ok) return globals
  const analyzed = analyzeSiteDraft(site, pages.value, globals.value, now)
  const report = buildSearchReport(analyzed, 50)
  return ok({
    site,
    pages: pages.value,
    globals: globals.value,
    analyzed,
    report,
    issueCount: report.pages.reduce((sum, page) => sum + page.issues, 0),
  })
}

/** Runs `task` over `items` with a small concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++
        out[index] = await task(items[index])
      }
    },
  )
  await Promise.all(workers)
  return out
}

async function saveSnapshot(analysis: SiteAnalysis, now: Date) {
  if (!analysis.pages.length) return
  const { averages } = analysis.report
  const saved = await SiteSeoRepository.upsertSnapshot({
    siteId: analysis.site.id,
    day: snapshotDay(now),
    seo: averages.seo,
    aeo: averages.aeo,
    geo: averages.geo,
    pages: analysis.pages.length,
    issues: analysis.issueCount,
  })
  if (!saved.ok) {
    logger.warn('site_seo.snapshot_failed', {
      component: 'SiteSeoService',
      siteId: analysis.site.id,
      code: saved.error.code,
    })
  }
}

function indexNowOf(site: Site) {
  const settings = parseSiteSettings(site.settings)
  const indexNow = searchSettingsOf(settings).indexNow
  return {
    enabled: indexNow.enabled,
    canPing:
      site.status === 'PUBLISHED' &&
      indexNow.enabled &&
      Boolean(indexNow.key) &&
      !settings.seo.noindex,
  }
}

function buildCard(
  analysis: SiteAnalysis,
  history: SiteSeoHistoryPointDTO[],
  keywordCount: number,
): { card: SiteSeoCardDTO; technical: TechnicalItemDTO[] } {
  const { site, report, pages, analyzed } = analysis
  const settings = parseSiteSettings(site.settings)
  const knownIds = new Set(pages.map((page) => page.id))
  const technical = buildTechnicalChecklist({
    pages: analyzed,
    broken: brokenLinks(
      pages.map((page) => ({
        id: page.id,
        title: page.title,
        document: page.document as unknown as CanvasDocument,
      })),
      knownIds,
    ),
    settings,
    published: site.status === 'PUBLISHED',
  })
  const first = history[0]
  const last = history[history.length - 1]
  const card: SiteSeoCardDTO = {
    id: site.id,
    name: site.name,
    slug: site.slug,
    status: site.status,
    url: publicSiteUrl(site.slug),
    pageCount: pages.length,
    hasData: pages.length > 0,
    averages: report.averages,
    overall: overallScore(report.averages),
    issueCount: analysis.issueCount,
    topIssues: report.issues.slice(0, 3).map((issue) => ({
      checkId: issue.checkId,
      pillar: issue.pillar,
      label: issue.label,
      message: issue.message,
      pageCount: issue.pages.length,
    })),
    worstPages: worstPages(report.pages),
    technical: technicalSummary(technical),
    keywordCount,
    indexNow: indexNowOf(site),
    history,
    delta:
      history.length >= 2 && first && last
        ? last.overall - first.overall
        : null,
  }
  return { card, technical }
}

export const SiteSeoService = {
  /** Every site of the workspace with its scores, problems and history. */
  async overview(
    actorId: string,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<SiteSeoOverviewDTO>> {
    const access = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access

    const sites = await SiteRepository.listByWorkspace(workspaceId)
    if (!sites.ok) return sites
    if (!sites.value.length) {
      return ok({ generatedAt: now.toISOString(), sites: [] })
    }

    const ids = sites.value.map((site) => site.id)
    const since = new Date(
      snapshotDay(now).getTime() - HISTORY_OVERVIEW_DAYS * DAY_MS,
    )
    const snapshots = await SiteSeoRepository.listSnapshots(ids, since)
    if (!snapshots.ok) return snapshots
    const keywordCounts = await Promise.all(
      ids.map((id) => SiteSeoRepository.countKeywords(id)),
    )

    const today = dayKey(snapshotDay(now))
    const cards = await mapLimit(
      sites.value,
      SITE_CONCURRENCY,
      async (site) => {
        const analysis = await analyzeSite(site, now)
        if (!analysis.ok) return analysis
        const own = snapshots.value.filter((item) => item.siteId === site.id)
        // First visit of the day: today's point is the live analysis.
        if (!own.some((item) => dayKey(item.day) === today)) {
          await saveSnapshot(analysis.value, now)
          if (analysis.value.pages.length) {
            const { averages } = analysis.value.report
            own.push({
              id: '',
              siteId: site.id,
              day: snapshotDay(now),
              ...averages,
              pages: analysis.value.pages.length,
              issues: analysis.value.issueCount,
              createdAt: now,
            })
          }
        }
        const index = ids.indexOf(site.id)
        const count = keywordCounts[index]
        return ok(
          buildCard(
            analysis.value,
            own.map(pointOf),
            count.ok ? count.value : 0,
          ).card,
        )
      },
    )

    const failed = cards.find((card) => !card.ok)
    if (failed && !failed.ok) return failed
    return ok({
      generatedAt: now.toISOString(),
      sites: cards.flatMap((card) => (card.ok ? [card.value] : [])),
    })
  },

  /** Full detail of one site (checklist, keywords, 90 days of history). */
  async detail(
    actorId: string,
    workspaceId: string,
    siteId: string,
    now: Date = new Date(),
  ): Promise<Result<SiteSeoDetailDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const analysis = await analyzeSite(site.value, now)
    if (!analysis.ok) return analysis
    const { pages, analyzed, report } = analysis.value

    const since = new Date(
      snapshotDay(now).getTime() - HISTORY_DETAIL_DAYS * DAY_MS,
    )
    const [snapshots, keywords] = await Promise.all([
      SiteSeoRepository.listSnapshots([siteId], since),
      SiteSeoRepository.listKeywords(siteId),
    ])
    if (!snapshots.ok) return snapshots
    if (!keywords.ok) return keywords

    const today = dayKey(snapshotDay(now))
    const points = snapshots.value.map(pointOf)
    if (pages.length && !points.some((point) => point.day === today)) {
      await saveSnapshot(analysis.value, now)
      points.push({
        day: today,
        ...report.averages,
        overall: overallScore(report.averages),
        issues: analysis.value.issueCount,
      })
    }

    const settings = parseSiteSettings(site.value.settings)
    const keywordPages = pages.map((page) => {
      const seo = parseSitePageSeo(page.seo)
      const path =
        analyzed.find((item) => item.id === page.id)?.path ?? `/${page.path}`
      return {
        id: page.id,
        title: page.title,
        path,
        seoTitle: renderedTitle(settings, { title: page.title, seo }),
        description: seo.description || settings.seo.description || '',
        content: extractPageContent(page.document as unknown as CanvasDocument),
        focusKeyword:
          parseSearchContent(seo.search).focusKeyword?.trim() || null,
      }
    })

    const { card, technical } = buildCard(
      analysis.value,
      points.slice(-HISTORY_OVERVIEW_DAYS),
      keywords.value.length,
    )
    return ok({
      generatedAt: now.toISOString(),
      card,
      pages: [...report.pages].sort(
        (a, b) =>
          (a.scores.seo + a.scores.aeo + a.scores.geo) / 3 -
            (b.scores.seo + b.scores.aeo + b.scores.geo) / 3 ||
          a.title.localeCompare(b.title),
      ),
      issues: report.issues,
      technical,
      keywords: keywords.value.map((keyword) =>
        analyzeKeyword({ id: keyword.id, term: keyword.term }, keywordPages),
      ),
      history: points,
    })
  },

  async addKeyword(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSeoKeywordDTO,
  ): Promise<Result<SiteSeoKeywordDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const count = await SiteSeoRepository.countKeywords(siteId)
    if (!count.ok) return count
    if (count.value >= MAX_SEO_KEYWORDS_PER_SITE) {
      return err(
        appError(
          'SEO_KEYWORD_LIMIT_REACHED',
          `Limite de ${MAX_SEO_KEYWORDS_PER_SITE} palavras-chave por site`,
        ),
      )
    }

    const term = cleanKeyword(dto.term)
    const created = await SiteSeoRepository.createKeyword({
      siteId,
      term,
      normalized: normalizeText(term),
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'site',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { scope: 'seo-keyword-add' },
    })
    return ok({ id: created.value.id, term: created.value.term })
  },

  async removeKeyword(
    actorId: string,
    workspaceId: string,
    siteId: string,
    keywordId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const deleted = await SiteSeoRepository.deleteKeyword(keywordId, siteId)
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'site',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { scope: 'seo-keyword-remove' },
    })
    return ok(undefined)
  },

  /** Sends the published URLs to IndexNow now (outside a publish). */
  async reindex(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteSeoReindexDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    if (site.value.status !== 'PUBLISHED') {
      return err(
        appError(
          'SEO_NOT_PUBLISHED',
          'Publique o site antes de pedir a reindexação',
        ),
      )
    }

    const published = await SiteRepository.findPublishedBySlug(site.value.slug)
    if (!published.ok) return published
    const snapshot = parseSiteSnapshot(
      published.value.publishedVersion.snapshot,
    )
    if (!snapshot.ok) {
      return err(
        appError('SEO_NOT_PUBLISHED', 'A versão publicada não pôde ser lida'),
      )
    }
    const indexNow = searchSettingsOf(snapshot.value.settings).indexNow
    if (!indexNow.enabled || !indexNow.key) {
      return err(
        appError(
          'SEO_INDEXNOW_OFF',
          'Ative o IndexNow em Buscadores > Rastreadores e publique o site',
        ),
      )
    }
    if (snapshot.value.settings.seo.noindex) {
      return err(
        appError(
          'SEO_INDEXNOW_OFF',
          'O site está escondido dos buscadores (noindex)',
        ),
      )
    }

    const pinged = await SiteIndexNowService.ping(
      site.value.slug,
      snapshot.value,
    )
    if (!pinged.ok) return pinged
    auditMutation({
      entity: 'site',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { scope: 'seo-reindex', sent: pinged.value.sent },
    })
    return ok(pinged.value)
  },

  /** Worker: today's snapshot of every site; old ones are pruned. */
  async recordDailySnapshots(
    now: Date = new Date(),
  ): Promise<Result<{ sites: number; failed: number; pruned: number }>> {
    const ids = await SiteSeoRepository.listSiteIdsForSnapshot()
    if (!ids.ok) return ids

    let failed = 0
    await mapLimit(ids.value, SITE_CONCURRENCY, async ({ id, workspaceId }) => {
      const site = await SiteRepository.findById(id, workspaceId)
      if (!site.ok) {
        failed += 1
        return
      }
      const analysis = await analyzeSite(site.value, now)
      if (!analysis.ok) {
        failed += 1
        return
      }
      await saveSnapshot(analysis.value, now)
    })

    const pruned = await SiteSeoRepository.pruneSnapshots(
      new Date(snapshotDay(now).getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS),
    )
    return ok({
      sites: ids.value.length,
      failed,
      pruned: pruned.ok ? pruned.value : 0,
    })
  },
}
