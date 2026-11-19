import { toCsv } from '@/src/lib/crm-export'
import type { SiteSeoDetailDTO } from '@/types/site-seo'

/**
 * CSV of the CRM > SEO report of a site (one table: summary, pages,
 * technical checklist and tracked keywords). Pure; the screen downloads it.
 */

const COLUMNS = ['Seção', 'Item', 'Detalhe', 'SEO', 'AEO', 'GEO', 'Situação']

const STATUS_LABEL = { pass: 'Ok', warn: 'Atenção', fail: 'Corrigir' } as const

const KEYWORD_LABEL = {
  ok: 'Ok',
  weak: 'Fraca',
  dense: 'Repetida demais',
  missing: 'Ausente',
} as const

export function buildSeoReportCsv(detail: SiteSeoDetailDTO): string {
  const { card } = detail
  const rows: Record<string, unknown>[] = [
    {
      Seção: 'Resumo',
      Item: card.name,
      Detalhe: `${card.pageCount} página(s), ${card.issueCount} ponto(s) a melhorar. Gerado em ${detail.generatedAt.slice(0, 10)}.`,
      SEO: card.averages.seo,
      AEO: card.averages.aeo,
      GEO: card.averages.geo,
      Situação: card.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho',
    },
    ...detail.pages.map((page) => ({
      Seção: 'Páginas',
      Item: page.title,
      Detalhe: `${page.path} · ${page.issues} ponto(s) a melhorar`,
      SEO: page.scores.seo,
      AEO: page.scores.aeo,
      GEO: page.scores.geo,
      Situação: '',
    })),
    ...detail.technical.map((item) => ({
      Seção: 'Checklist técnico',
      Item: item.label,
      Detalhe: item.detail,
      Situação: STATUS_LABEL[item.status],
    })),
    ...detail.keywords.map((keyword) => ({
      Seção: 'Palavras-chave',
      Item: keyword.term,
      Detalhe: keyword.gaps.length
        ? keyword.gaps.join(' ')
        : `${keyword.totalCount} ocorrência(s) em ${keyword.pages.length} página(s).`,
      Situação: KEYWORD_LABEL[keyword.status],
    })),
  ]
  return toCsv(COLUMNS, rows)
}

/** `seo-<slug>-<yyyy-mm-dd>.csv`. */
export function seoReportFilename(slug: string, generatedAt: string): string {
  return `seo-${slug}-${generatedAt.slice(0, 10)}.csv`
}
