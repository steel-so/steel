import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import type { SearchPageAnalysis } from './analyze'
import type { PageContent } from './content'
import { countWords, normalizeText } from './text'
import type { SearchCheck } from './types'

/**
 * Pure helpers of CRM > SEO: the technical checklist aggregated over the
 * pages of a site, the tracked keywords (where they appear, density, gaps)
 * and the history sparkline. Reads what the per-page analysis already
 * computed, so the numbers agree with "Buscadores" in the site editor.
 */

// ─── technical checklist ─────────────────────────────────────────────────

export type TechnicalStatus = 'pass' | 'warn' | 'fail'

export interface TechnicalItemDTO {
  id: string
  label: string
  /** pt-BR explanation of why it matters. */
  hint: string
  /** `pages`: counted page by page. `site`: one answer for the whole site. */
  scope: 'pages' | 'site'
  status: TechnicalStatus
  /** Pages evaluated (scope `pages`), else 0. */
  total: number
  passed: number
  warned: number
  failed: number
  /** pt-BR summary line ("3 de 5 páginas com problema"). */
  detail: string
  /** Up to five pages that need attention. */
  pages: Array<{ id: string; title: string }>
}

export interface AnalyzedPage {
  id: string
  title: string
  path: string
  analysis: SearchPageAnalysis
}

const PAGE_CHECKS: Array<{ id: string; label: string; hint: string }> = [
  {
    id: 'seo.title-length',
    label: 'Título da página (title)',
    hint: 'O título aparece como link azul no Google. Entre 30 e 60 caracteres.',
  },
  {
    id: 'seo.description',
    label: 'Descrição (meta description)',
    hint: 'O resumo abaixo do título nos resultados. Entre 120 e 160 caracteres.',
  },
  {
    id: 'seo.h1',
    label: 'Título principal (H1)',
    hint: 'Cada página precisa de um único H1 dizendo o assunto.',
  },
  {
    id: 'seo.canonical',
    label: 'Endereço canônico',
    hint: 'Evita que o buscador mostre outro endereço no lugar da página.',
  },
  {
    id: 'seo.image-alt',
    label: 'Texto alternativo das imagens',
    hint: 'Descreve cada imagem para buscadores e leitores de tela.',
  },
  {
    id: 'seo.indexable',
    label: 'Visível nos buscadores',
    hint: 'Páginas marcadas como noindex não aparecem no Google.',
  },
]

function findCheck(
  analysis: SearchPageAnalysis,
  id: string,
): SearchCheck | undefined {
  return analysis.seo.checks.find((item) => item.id === id)
}

function statusOf(warned: number, failed: number): TechnicalStatus {
  if (failed > 0) return 'fail'
  if (warned > 0) return 'warn'
  return 'pass'
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function pageItem(
  def: (typeof PAGE_CHECKS)[number],
  pages: AnalyzedPage[],
): TechnicalItemDTO {
  let passed = 0
  let warned = 0
  let failed = 0
  const attention: Array<{ id: string; title: string }> = []
  for (const page of pages) {
    const found = findCheck(page.analysis, def.id)
    // A check that does not apply to the page (e.g. no images) counts as ok.
    if (!found || found.status === 'pass') passed += 1
    else {
      if (found.status === 'warn') warned += 1
      else failed += 1
      attention.push({ id: page.id, title: page.title })
    }
  }
  const bad = warned + failed
  return {
    id: def.id,
    label: def.label,
    hint: def.hint,
    scope: 'pages',
    status: statusOf(warned, failed),
    total: pages.length,
    passed,
    warned,
    failed,
    detail: !pages.length
      ? 'Nenhuma página para avaliar.'
      : bad === 0
        ? 'Todas as páginas estão corretas.'
        : `${plural(bad, 'página precisa', 'páginas precisam')} de atenção (de ${pages.length}).`,
    pages: attention.slice(0, 5),
  }
}

function siteItem(
  id: string,
  label: string,
  hint: string,
  status: TechnicalStatus,
  detail: string,
): TechnicalItemDTO {
  return {
    id,
    label,
    hint,
    scope: 'site',
    status,
    total: 0,
    passed: status === 'pass' ? 1 : 0,
    warned: status === 'warn' ? 1 : 0,
    failed: status === 'fail' ? 1 : 0,
    detail,
    pages: [],
  }
}

/** Page ids a document links to (`link` values of type `page`). */
export function pageLinkTargets(document: CanvasDocument): string[] {
  const out: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    if (
      record.type === 'page' &&
      typeof record.value === 'string' &&
      record.value.trim()
    ) {
      out.push(record.value.trim())
      return
    }
    for (const item of Object.values(record)) visit(item, depth + 1)
  }
  for (const node of Object.values(document.nodes ?? {})) {
    if (node.meta?.hidden) continue
    visit(node.props, 0)
  }
  return out
}

/** Broken internal links: links to pages that no longer exist. */
export function brokenLinks(
  pages: Array<{ id: string; title: string; document: CanvasDocument }>,
  knownPageIds: Set<string>,
): Array<{ id: string; title: string; broken: number }> {
  const out: Array<{ id: string; title: string; broken: number }> = []
  for (const page of pages) {
    const broken = pageLinkTargets(page.document).filter(
      (target) => !knownPageIds.has(target),
    ).length
    if (broken > 0) out.push({ id: page.id, title: page.title, broken })
  }
  return out
}

export interface TechnicalInput {
  pages: AnalyzedPage[]
  broken: Array<{ id: string; title: string; broken: number }>
  settings: SiteSettingsDTO
  published: boolean
}

/** The technical checklist: per-page checks plus site-level files. */
export function buildTechnicalChecklist(
  input: TechnicalInput,
): TechnicalItemDTO[] {
  const { pages, broken, settings, published } = input
  const items = PAGE_CHECKS.map((def) => pageItem(def, pages))

  const totalBroken = broken.reduce((sum, page) => sum + page.broken, 0)
  items.push({
    id: 'links.broken',
    label: 'Links quebrados',
    hint: 'Links internos que apontam para páginas que foram apagadas.',
    scope: 'pages',
    status: totalBroken > 0 ? 'fail' : 'pass',
    total: pages.length,
    passed: pages.length - broken.length,
    warned: 0,
    failed: broken.length,
    detail:
      totalBroken > 0
        ? `${plural(totalBroken, 'link quebrado', 'links quebrados')} em ${plural(broken.length, 'página', 'páginas')}.`
        : 'Nenhum link interno quebrado.',
    pages: broken.slice(0, 5).map(({ id, title }) => ({ id, title })),
  })

  const hidden = Boolean(settings.seo.noindex)
  items.push(
    siteItem(
      'site.sitemap',
      'Sitemap (sitemap.xml)',
      'Lista as páginas para os buscadores. É gerado sozinho na publicação.',
      hidden ? 'fail' : published ? 'pass' : 'warn',
      hidden
        ? 'O site está escondido dos buscadores: o sitemap fica vazio.'
        : published
          ? 'Gerado automaticamente a cada publicação.'
          : 'Publique o site para gerar o sitemap.',
    ),
    siteItem(
      'site.robots',
      'Rastreadores (robots.txt)',
      'Diz quais robôs podem visitar o site. É gerado sozinho na publicação.',
      hidden ? 'fail' : published ? 'pass' : 'warn',
      hidden
        ? 'O robots.txt bloqueia todos os buscadores (site marcado como noindex).'
        : published
          ? 'Ativo. Ajuste o acesso por robô de IA em Buscadores.'
          : 'Publique o site para gerar o robots.txt.',
    ),
  )
  return items
}

export function technicalSummary(items: TechnicalItemDTO[]) {
  return {
    pass: items.filter((item) => item.status === 'pass').length,
    warn: items.filter((item) => item.status === 'warn').length,
    fail: items.filter((item) => item.status === 'fail').length,
    total: items.length,
  }
}

// ─── keywords ────────────────────────────────────────────────────────────

/** Densities above this are flagged as keyword stuffing (percent). */
export const KEYWORD_DENSITY_MAX = 3

export type KeywordStatus = 'missing' | 'weak' | 'ok' | 'dense'

export interface KeywordPageUsageDTO {
  id: string
  title: string
  path: string
  count: number
  /** Percent of the page's words (two decimals). */
  density: number
  inTitle: boolean
  inDescription: boolean
  inH1: boolean
  inHeadings: boolean
  /** The page declares this term as its focus keyword. */
  focus: boolean
}

export interface KeywordReportDTO {
  id: string
  term: string
  status: KeywordStatus
  /** pt-BR gaps to fix ("Não aparece em nenhum título"). */
  gaps: string[]
  totalCount: number
  pages: KeywordPageUsageDTO[]
}

export interface KeywordPageInput {
  id: string
  title: string
  path: string
  /** Title as published and the meta description. */
  seoTitle: string
  description: string
  content: PageContent
  focusKeyword: string | null
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word occurrences of a term in a text (accent/case-insensitive). */
export function countOccurrences(text: string, term: string): number {
  const needle = normalizeText(term)
  if (!needle) return 0
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    'gu',
  )
  return (normalizeText(text).match(pattern) ?? []).length
}

export function analyzeKeyword(
  keyword: { id: string; term: string },
  pages: KeywordPageInput[],
): KeywordReportDTO {
  const termWords = Math.max(1, countWords(keyword.term))
  const usage: KeywordPageUsageDTO[] = pages.map((page) => {
    const count = countOccurrences(page.content.text, keyword.term)
    const words = page.content.words
    const h1 = page.content.headings.filter((item) => item.level === 1)
    return {
      id: page.id,
      title: page.title,
      path: page.path,
      count,
      density: words
        ? Math.round(((count * termWords) / words) * 10000) / 100
        : 0,
      inTitle: countOccurrences(page.seoTitle, keyword.term) > 0,
      inDescription: countOccurrences(page.description, keyword.term) > 0,
      inH1: h1.some((item) => countOccurrences(item.text, keyword.term) > 0),
      inHeadings: page.content.headings.some(
        (item) => countOccurrences(item.text, keyword.term) > 0,
      ),
      focus:
        page.focusKeyword !== null &&
        normalizeText(page.focusKeyword) === normalizeText(keyword.term),
    }
  })

  const used = usage.filter(
    (item) => item.count > 0 || item.inTitle || item.inDescription,
  )
  const totalCount = usage.reduce((sum, item) => sum + item.count, 0)
  const gaps: string[] = []
  let status: KeywordStatus = 'ok'

  if (used.length === 0) {
    status = 'missing'
    gaps.push(
      pages.length
        ? 'Não aparece em nenhuma página do site.'
        : 'O site ainda não tem páginas.',
    )
  } else {
    if (!usage.some((item) => item.inTitle)) {
      gaps.push('Não aparece em nenhum título de página.')
    }
    if (!usage.some((item) => item.inH1 || item.inHeadings)) {
      gaps.push('Não aparece em nenhum título interno (H1, H2…).')
    }
    if (!usage.some((item) => item.inDescription)) {
      gaps.push('Não aparece em nenhuma descrição.')
    }
    if (!usage.some((item) => item.focus)) {
      gaps.push('Nenhuma página usa o termo como palavra-chave principal.')
    }
    const dense = usage.filter((item) => item.density > KEYWORD_DENSITY_MAX)
    if (dense.length) {
      status = 'dense'
      gaps.push(
        `Densidade acima de ${KEYWORD_DENSITY_MAX}% em ${plural(dense.length, 'página', 'páginas')}: pode parecer repetição forçada.`,
      )
    } else if (!usage.some((item) => item.inTitle || item.inH1)) {
      status = 'weak'
    }
  }

  return {
    id: keyword.id,
    term: keyword.term,
    status,
    gaps,
    totalCount,
    pages: usage
      .filter((item) => item.count > 0 || item.inTitle || item.inDescription)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
  }
}

// ─── overview helpers ────────────────────────────────────────────────────

export interface WorstPageDTO {
  id: string
  title: string
  path: string
  /** Mean of the three pillars. */
  score: number
  issues: number
}

/** Lowest scoring pages (mean of SEO, AEO and GEO). */
export function worstPages(
  pages: Array<{
    id: string
    title: string
    path: string
    scores: { seo: number; aeo: number; geo: number }
    issues: number
  }>,
  limit = 3,
): WorstPageDTO[] {
  return pages
    .map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path,
      score: Math.round(
        (page.scores.seo + page.scores.aeo + page.scores.geo) / 3,
      ),
      issues: page.issues,
    }))
    .filter((page) => page.issues > 0)
    .sort((a, b) => a.score - b.score || b.issues - a.issues)
    .slice(0, limit)
}

/** Mean of the three pillar averages (0 when there are no pages). */
export function overallScore(averages: {
  seo: number
  aeo: number
  geo: number
}): number {
  return Math.round((averages.seo + averages.aeo + averages.geo) / 3)
}

/** UTC midnight of a date (the day a snapshot stands for). */
export function snapshotDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

/** Keyword as stored: trimmed, single-spaced. */
export function cleanKeyword(term: string): string {
  return term.replace(/\s+/g, ' ').trim()
}
