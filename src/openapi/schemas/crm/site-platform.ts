import { z } from 'zod'
import { dto } from '../../common'

/** DTOs da fase S2 dos sites (plataforma) — `types/site-platform.d.ts`. */

export const SiteRedirectDTOSchema = dto(
  'SiteRedirect',
  z.object({
    id: z.string(),
    siteId: z.string(),
    fromPath: z.string().meta({ example: '/servicos-antigos' }),
    toPath: z.string().meta({ example: '/servicos' }),
    permanent: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

const COUNT = z.object({
  key: z.string().nullable().meta({ example: '/contato' }),
  label: z.string().nullable().optional().meta({ example: 'Contato' }),
  views: z.number().int(),
  visitors: z.number().int(),
})

export const SiteAnalyticsDTOSchema = dto(
  'SiteAnalytics',
  z
    .object({
      siteId: z.string(),
      timezone: z.string().meta({ example: 'America/Sao_Paulo' }),
      from: z.string().meta({ example: '2026-09-16' }),
      to: z.string().meta({ example: '2026-10-15' }),
      totals: z.object({
        views: z.number().int(),
        visitors: z.number().int(),
        conversions: z.number().int(),
        conversionRate: z.number().meta({ example: 0.034 }),
      }),
      previous: z.object({
        views: z.number().int(),
        visitors: z.number().int(),
        conversions: z.number().int(),
      }),
      days: z.array(
        z.object({
          date: z.string().meta({ example: '2026-10-15' }),
          views: z.number().int(),
          visitors: z.number().int(),
          conversions: z.number().int(),
        }),
      ),
      topPages: z.array(COUNT),
      referrers: z.array(COUNT),
      utmSources: z.array(COUNT),
      utmMediums: z.array(COUNT),
      utmCampaigns: z.array(COUNT),
      conversionsByPage: z.array(
        z.object({
          path: z.string(),
          label: z.string().nullable(),
          views: z.number().int(),
          conversions: z.number().int(),
          rate: z.number(),
        }),
      ),
    })
    .meta({
      description:
        'Métricas anônimas do site no período (dias no fuso do site): visitas, visitantes por dia, páginas, origens, UTM e conversões de formulário por página, com o período anterior de mesmo tamanho para comparação.',
    }),
)

export const SiteAnalyticsSummaryDTOSchema = dto(
  'SiteAnalyticsSummary',
  z.object({
    from: z.string(),
    to: z.string(),
    sites: z.array(
      z.object({
        siteId: z.string(),
        views: z.array(z.number().int()),
        total: z.number().int(),
      }),
    ),
  }),
)
