import { z } from 'zod'
import { SiteSearchSettingsSchema } from '@/src/schemas/site-search.schema'
import { dto } from '../../common'

/** DTOs dos Buscadores dos sites (SEO, AEO, GEO) — `types/site-search.d.ts`. */

const COMPLETENESS = z.object({
  percent: z.number().int().meta({ example: 78 }),
  missing: z
    .array(z.string())
    .meta({ example: ['telefone', 'horário de funcionamento'] }),
})

const PILLAR = z.enum(['seo', 'aeo', 'geo'])
const STATUS = z.enum(['pass', 'warn', 'fail'])
const SCORES = z.object({
  seo: z.number().int().meta({ example: 82 }),
  aeo: z.number().int().meta({ example: 55 }),
  geo: z.number().int().meta({ example: 64 }),
})

export const SiteSearchSettingsViewDTOSchema = dto(
  'SiteSearchSettingsView',
  z.object({
    settings: SiteSearchSettingsSchema,
    prefilled: z.boolean(),
    completeness: COMPLETENESS,
    published: z.boolean(),
    urls: z.object({
      robots: z
        .string()
        .meta({ example: 'https://clinica.sites.steel.app/robots.txt' }),
      sitemap: z.string(),
      llms: z
        .string()
        .meta({ example: 'https://clinica.sites.steel.app/llms.txt' }),
      llmsFull: z.string(),
      indexNowKey: z.string().nullable(),
    }),
  }),
)

export const SiteSearchReportDTOSchema = dto(
  'SiteSearchReport',
  z.object({
    generatedAt: z.iso.datetime(),
    completeness: COMPLETENESS,
    averages: SCORES,
    pages: z.array(
      z.object({
        id: z.string(),
        title: z.string().meta({ example: 'Implante dentário' }),
        path: z.string().meta({ example: '/implante-dentario' }),
        scores: SCORES,
        issues: z.number().int(),
      }),
    ),
    issues: z.array(
      z.object({
        checkId: z.string().meta({ example: 'aeo.direct-answers' }),
        pillar: PILLAR,
        label: z.string(),
        impact: z.number(),
        message: z.string(),
        pages: z.array(
          z.object({ id: z.string(), title: z.string(), status: STATUS }),
        ),
      }),
    ),
  }),
)

export const SiteSearchAiSummaryDTOSchema = dto(
  'SiteSearchAiSummary',
  z.object({
    summary: z.string(),
    entities: z.array(z.string()),
    questions: z.array(z.string()),
    suggestions: z.array(z.string()),
  }),
)

const CHANGE = z.object({ current: z.string(), suggested: z.string() })

export const SiteSearchAiOptimizeDTOSchema = dto(
  'SiteSearchAiOptimize',
  z.object({
    items: z.array(
      z.object({
        pageId: z.string(),
        pageTitle: z.string(),
        title: CHANGE.optional(),
        description: CHANGE.optional(),
        answers: z.array(CHANGE.extend({ question: z.string() })).optional(),
      }),
    ),
    failed: z.array(z.object({ pageId: z.string(), pageTitle: z.string() })),
  }),
)

export const SiteSearchApplyResultDTOSchema = dto(
  'SiteSearchApplyResult',
  z.object({ updated: z.array(z.string()) }),
)
