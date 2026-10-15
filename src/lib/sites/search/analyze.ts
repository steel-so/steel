import { aeoChecks } from './aeo-checks'
import { buildCheckContext } from './context'
import { geoChecks } from './geo-checks'
import { seoChecks } from './seo-checks'
import {
  SEARCH_PILLARS,
  type SearchCheck,
  type SearchCheckStatus,
  type SearchPageAnalysis,
  type SearchPageInput,
  type SearchPillar,
  type SearchPillarResult,
} from './types'

/**
 * Scores of a page in the three pillars (0–100 each): the weighted share
 * of checks passed, a warning counting half. Deterministic and pure, so the
 * editor panel (live document) and the site report (server) agree.
 */

const STATUS_VALUE: Record<SearchCheckStatus, number> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
}

export function scoreChecks(
  checks: Array<Pick<SearchCheck, 'status' | 'weight'>>,
): number {
  const total = checks.reduce((sum, item) => sum + item.weight, 0)
  if (total === 0) return 100
  const earned = checks.reduce(
    (sum, item) => sum + item.weight * STATUS_VALUE[item.status],
    0,
  )
  return Math.round((earned / total) * 100)
}

/** Points a check loses (its weight times what it misses). */
export function checkImpact(
  item: Pick<SearchCheck, 'status' | 'weight'>,
): number {
  return item.weight * (1 - STATUS_VALUE[item.status])
}

function pillar(
  name: SearchPillar,
  checks: Array<Omit<SearchCheck, 'pillar'>>,
): SearchPillarResult {
  const full = checks.map((item) => ({ ...item, pillar: name }))
  return { score: scoreChecks(full), checks: full }
}

export function analyzeSearchPage(input: SearchPageInput): SearchPageAnalysis {
  const ctx = buildCheckContext(input)
  return {
    seo: pillar('seo', seoChecks(ctx)),
    aeo: pillar('aeo', aeoChecks(ctx)),
    geo: pillar('geo', geoChecks(ctx)),
  }
}

/** Score band for colors and labels. */
export type SearchScoreBand = 'good' | 'fair' | 'poor'

export function scoreBand(score: number): SearchScoreBand {
  if (score >= 80) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

export const SCORE_BAND_LABELS: Record<SearchScoreBand, string> = {
  good: 'Bom',
  fair: 'Regular',
  poor: 'Precisa de atenção',
}

// ─── site report ─────────────────────────────────────────────────────────

export interface SearchReportPage {
  id: string
  title: string
  path: string
  scores: Record<SearchPillar, number>
  /** Failed and warned checks of the page. */
  issues: number
}

export interface SearchReportIssue {
  checkId: string
  pillar: SearchPillar
  label: string
  /** Sum of the points lost on every page (higher first). */
  impact: number
  /** Message of the worst page. */
  message: string
  pages: Array<{ id: string; title: string; status: SearchCheckStatus }>
}

export interface SearchReport {
  averages: Record<SearchPillar, number>
  pages: SearchReportPage[]
  issues: SearchReportIssue[]
}

/** Site overview: average scores, pages and the issues ranked by how many
 * points they cost across the site. */
export function buildSearchReport(
  pages: Array<{
    id: string
    title: string
    path: string
    analysis: SearchPageAnalysis
  }>,
  limit = 12,
): SearchReport {
  const averages = Object.fromEntries(
    SEARCH_PILLARS.map((name) => [
      name,
      pages.length
        ? Math.round(
            pages.reduce((sum, page) => sum + page.analysis[name].score, 0) /
              pages.length,
          )
        : 0,
    ]),
  ) as Record<SearchPillar, number>

  const issues = new Map<string, SearchReportIssue & { worst: number }>()
  const rows: SearchReportPage[] = pages.map((page) => {
    let count = 0
    for (const name of SEARCH_PILLARS) {
      for (const item of page.analysis[name].checks) {
        const impact = checkImpact(item)
        if (impact === 0) continue
        count += 1
        const current = issues.get(item.id) ?? {
          checkId: item.id,
          pillar: item.pillar,
          label: item.label,
          impact: 0,
          message: item.message,
          pages: [],
          worst: -1,
        }
        current.impact += impact
        current.pages.push({
          id: page.id,
          title: page.title,
          status: item.status,
        })
        if (impact > current.worst) {
          current.worst = impact
          current.message = item.message
        }
        issues.set(item.id, current)
      }
    }
    return {
      id: page.id,
      title: page.title,
      path: page.path,
      scores: {
        seo: page.analysis.seo.score,
        aeo: page.analysis.aeo.score,
        geo: page.analysis.geo.score,
      },
      issues: count,
    }
  })

  return {
    averages,
    pages: rows,
    issues: [...issues.values()]
      .sort((a, b) => b.impact - a.impact || a.checkId.localeCompare(b.checkId))
      .slice(0, limit)
      .map(({ worst: _worst, ...issue }) => issue),
  }
}
