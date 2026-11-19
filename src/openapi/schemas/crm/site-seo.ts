import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do CRM > SEO — `types/site-seo.d.ts`. */

const PILLAR = z.enum(['seo', 'aeo', 'geo'])
const STATUS = z.enum(['pass', 'warn', 'fail'])
const SCORES = z.object({
  seo: z.number().int().meta({ example: 82 }),
  aeo: z.number().int().meta({ example: 55 }),
  geo: z.number().int().meta({ example: 64 }),
})

const HISTORY_POINT = z.object({
  day: z.string().meta({ example: '2026-11-19' }),
  seo: z.number().int(),
  aeo: z.number().int(),
  geo: z.number().int(),
  overall: z
    .number()
    .int()
    .meta({ description: 'Média de SEO, AEO e GEO.', example: 67 }),
  issues: z.number().int(),
})

const CARD = z.object({
  id: z.string(),
  name: z.string().meta({ example: 'Clínica Sorriso' }),
  slug: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  url: z.string().meta({ example: 'https://sorriso.sites.steel.app' }),
  pageCount: z.number().int(),
  hasData: z
    .boolean()
    .meta({ description: 'O site tem páginas para pontuar.' }),
  averages: SCORES,
  overall: z.number().int().meta({ example: 67 }),
  issueCount: z.number().int(),
  topIssues: z.array(
    z.object({
      checkId: z.string().meta({ example: 'seo.h1' }),
      pillar: PILLAR,
      label: z.string(),
      message: z.string(),
      pageCount: z.number().int(),
    }),
  ),
  worstPages: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      score: z.number().int(),
      issues: z.number().int(),
    }),
  ),
  technical: z.object({
    pass: z.number().int(),
    warn: z.number().int(),
    fail: z.number().int(),
    total: z.number().int(),
  }),
  keywordCount: z.number().int(),
  indexNow: z.object({
    enabled: z.boolean(),
    canPing: z.boolean().meta({
      description:
        'Site publicado, visível aos buscadores e com chave: dá para reindexar.',
    }),
  }),
  history: z.array(HISTORY_POINT).meta({ description: 'Últimos 30 dias.' }),
  delta: z.number().int().nullable().meta({
    description: 'Variação da nota geral na janela (null com menos de 2 dias).',
  }),
})

export const SiteSeoOverviewDTOSchema = dto(
  'SiteSeoOverview',
  z.object({
    generatedAt: z.iso.datetime(),
    sites: z.array(CARD),
  }),
)

const TECHNICAL_ITEM = z.object({
  id: z.string().meta({ example: 'seo.title-length' }),
  label: z.string(),
  hint: z.string(),
  scope: z.enum(['pages', 'site']),
  status: STATUS,
  total: z.number().int(),
  passed: z.number().int(),
  warned: z.number().int(),
  failed: z.number().int(),
  detail: z.string(),
  pages: z.array(z.object({ id: z.string(), title: z.string() })),
})

const KEYWORD_REPORT = z.object({
  id: z.string(),
  term: z.string().meta({ example: 'clareamento dental' }),
  status: z.enum(['missing', 'weak', 'ok', 'dense']),
  gaps: z.array(z.string()),
  totalCount: z.number().int(),
  pages: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      count: z.number().int(),
      density: z.number().meta({ description: '% das palavras da página.' }),
      inTitle: z.boolean(),
      inDescription: z.boolean(),
      inH1: z.boolean(),
      inHeadings: z.boolean(),
      focus: z.boolean(),
    }),
  ),
})

export const SiteSeoDetailDTOSchema = dto(
  'SiteSeoDetail',
  z.object({
    generatedAt: z.iso.datetime(),
    card: CARD,
    pages: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        path: z.string(),
        scores: SCORES,
        issues: z.number().int(),
      }),
    ),
    issues: z.array(
      z.object({
        checkId: z.string(),
        pillar: PILLAR,
        label: z.string(),
        impact: z.number(),
        message: z.string(),
        pages: z.array(
          z.object({ id: z.string(), title: z.string(), status: STATUS }),
        ),
      }),
    ),
    technical: z.array(TECHNICAL_ITEM),
    keywords: z.array(KEYWORD_REPORT),
    history: z.array(HISTORY_POINT).meta({ description: 'Últimos 90 dias.' }),
  }),
)

export const SiteSeoKeywordDTOSchema = dto(
  'SiteSeoKeyword',
  z.object({ id: z.string(), term: z.string() }),
)

export const SiteSeoReindexDTOSchema = dto(
  'SiteSeoReindex',
  z.object({
    sent: z.number().int().meta({ description: 'URLs enviadas.' }),
    status: z.number().int().nullable().meta({
      description: 'Status HTTP do buscador; null em erro de rede.',
    }),
  }),
)
