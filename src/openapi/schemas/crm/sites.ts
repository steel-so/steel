import { z } from 'zod'
import { SiteSettingsSchema } from '@/src/schemas/site.schema'
import { SitePageSeoSchema } from '@/src/schemas/site-page.schema'
import { dto } from '../../common'

/** DTOs do construtor de sites — `types/site.d.ts`. */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()
const SITE_STATUS = z.enum(['DRAFT', 'PUBLISHED'])
const GLOBAL_KIND = z.enum(['HEADER', 'FOOTER', 'SYMBOL'])

export const SiteCanvasDocumentDTO = dto(
  'SiteCanvasDocument',
  z
    .object({
      catalog: z.literal('site'),
      version: z.number().int().meta({ example: 1 }),
      rootId: z.literal('root'),
      nodes: z.record(
        z.string(),
        z.object({
          id: z.string(),
          type: z.string().meta({ example: 'site.heading' }),
          props: z.record(z.string(), z.unknown()),
          children: z.array(z.string()).optional(),
          meta: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    })
    .meta({
      description:
        'Documento normalizado do Steel Canvas, catálogo `site` (ADR 0026): mapa plano de nós a partir de `root` (`site.page`).',
    }),
)

export const SiteDTOSchema = dto(
  'Site',
  z.object({
    id: z.string().meta({ example: 'ckw1site0000ab7d3k1e5xyz' }),
    workspaceId: z.string(),
    name: z.string().meta({ example: 'Clínica São Lucas' }),
    slug: z.string().meta({
      description:
        'Endereço do site, único entre todos os workspaces: subdomínio `<slug>.<SITES_ROOT_DOMAIN>` e caminho `/s/<slug>`.',
      example: 'clinica-sao-lucas',
    }),
    status: SITE_STATUS,
    theme: z.record(z.string(), z.unknown()).meta({
      description: 'Tema do catálogo `site` (paleta, tipografia, botões…).',
    }),
    settings: SiteSettingsSchema,
    homePageId: z.string().nullable(),
    publishedVersionId: z.string().nullable(),
    publishedAt: nullableDateTime(),
    url: z.string().meta({
      description: 'Endereço público do site.',
      example: 'https://clinica-sao-lucas.sites.steel.app',
    }),
    sourceLandingPageId: z.string().nullable().meta({
      description: 'Landing page de origem, quando o site veio da migração.',
    }),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const SiteSummaryDTOSchema = dto(
  'SiteSummary',
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: SITE_STATUS,
    url: z.string(),
    pageCount: z.number().int(),
    publishedAt: nullableDateTime(),
    updatedAt: dateTime(),
  }),
)

const pageSummaryShape = {
  id: z.string().meta({ example: 'ckw1page0000ab7d3k1e5xyz' }),
  siteId: z.string(),
  parentId: z.string().nullable(),
  title: z.string().meta({ example: 'Contato' }),
  slug: z.string().meta({ example: 'contato' }),
  path: z.string().meta({
    description: 'Caminho completo (slugs dos pais + o próprio).',
    example: 'servicos/consultoria',
  }),
  position: z.number().int(),
  isHome: z.boolean(),
  seo: SitePageSeoSchema,
  updatedAt: dateTime(),
}

export const SitePageSummaryDTOSchema = dto(
  'SitePageSummary',
  z.object(pageSummaryShape),
)

export const SitePageDTOSchema = dto(
  'SitePage',
  z.object({
    ...pageSummaryShape,
    document: SiteCanvasDocumentDTO,
    createdAt: dateTime(),
  }),
)

export const SiteGlobalDTOSchema = dto(
  'SiteGlobal',
  z.object({
    id: z.string(),
    siteId: z.string(),
    kind: GLOBAL_KIND.meta({
      description:
        '`HEADER`/`FOOTER` envolvem todas as páginas (um de cada por site); `SYMBOL` é um bloco reutilizável.',
    }),
    name: z.string(),
    document: SiteCanvasDocumentDTO,
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const SiteVersionDTOSchema = dto(
  'SiteVersion',
  z.object({
    id: z.string(),
    siteId: z.string(),
    number: z.number().int().meta({ example: 3 }),
    publishedById: z.string().nullable(),
    publishedByName: z.string().nullable(),
    isLive: z.boolean().meta({ description: 'Versão no ar agora.' }),
    createdAt: dateTime(),
  }),
)

export const SitePublishResultDTO = dto(
  'SitePublishResult',
  z.object({ site: SiteDTOSchema, version: SiteVersionDTOSchema }),
)

export const SiteSlugAvailabilityDTO = dto(
  'SiteSlugAvailability',
  z.object({ slug: z.string(), available: z.boolean() }),
)

const MigrationItem = z.object({
  landingPageId: z.string(),
  siteId: z.string(),
  slug: z.string(),
  status: z.enum(['created', 'skipped']),
  published: z.boolean(),
})

export const SiteLandingMigrationReportDTO = dto(
  'SiteLandingMigrationReport',
  z.object({
    created: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    items: z.array(MigrationItem),
  }),
)
