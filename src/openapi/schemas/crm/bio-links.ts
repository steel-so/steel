import { z } from 'zod'
import { BioBlockSchema, BioThemeSchema } from '@/src/schemas/bio-link.schema'
import { dto } from '../../common'

/**
 * DTOs de CRM · Link da bio — `types/bio-link.d.ts`.
 */

const dateTime = () => z.iso.datetime()
const STATUS = z.enum(['DRAFT', 'PUBLISHED'])

export const BioLinkDTOSchema = dto(
  'BioLink',
  z
    .object({
      id: z.string().meta({ example: 'ckw1bio00000ab7d3k1e5xyz' }),
      workspaceId: z.string(),
      name: z.string().meta({ example: 'Instagram da loja' }),
      slug: z.string().meta({ example: 'minha-loja' }),
      status: STATUS.meta({
        description: 'Só páginas `PUBLISHED` respondem em `/b/<slug>`.',
      }),
      title: z.string().nullable().meta({
        description: 'Nome mostrado na página (cai para `name` quando vazio).',
      }),
      description: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      theme: BioThemeSchema,
      blocks: z.array(BioBlockSchema).meta({
        description:
          'Itens na ordem da página: botões (`link`), títulos de seção (`header`), formulário do CRM (`form`) e vídeo do YouTube (`video`).',
      }),
      noIndex: z.boolean(),
      publishedAt: dateTime().nullable(),
      url: z.string().meta({
        description: 'Endereço público (`<app>/b/<slug>`).',
        example: 'https://app.exemplo.com.br/b/minha-loja',
      }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Página de link da bio.' }),
)

export const BioLinkSummaryDTOSchema = dto(
  'BioLinkSummary',
  z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      status: STATUS,
      avatarUrl: z.string().nullable(),
      url: z.string(),
      linkCount: z.number().int().meta({
        description: 'Botões e vídeos da página.',
      }),
      views: z.number().int().meta({ description: 'Visitas, desde sempre.' }),
      clicks: z.number().int().meta({ description: 'Cliques, desde sempre.' }),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Linha da lista de páginas de link da bio.' }),
)

export const BioLinkSlugAvailabilityDTO = dto(
  'BioLinkSlugAvailability',
  z.object({ slug: z.string(), available: z.boolean() }),
)

export const BioLinkOptionsDTOSchema = dto(
  'BioLinkOptions',
  z
    .object({
      whatsapp: z.array(
        z.object({ id: z.string(), label: z.string(), phone: z.string() }),
      ),
      sites: z.array(
        z.object({ id: z.string(), name: z.string(), url: z.string() }),
      ),
      forms: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          publicToken: z.string(),
        }),
      ),
    })
    .meta({
      description:
        'Linhas de WhatsApp conectadas, sites publicados e formulários publicados do workspace, para os botões prontos do editor.',
    }),
)

const count = z.object({
  key: z.string().nullable(),
  count: z.number().int(),
})

export const BioLinkAnalyticsDTOSchema = dto(
  'BioLinkAnalytics',
  z
    .object({
      bioLinkId: z.string(),
      timezone: z.string().meta({ example: 'America/Sao_Paulo' }),
      from: z.string().meta({ example: '2026-10-21' }),
      to: z.string().meta({ example: '2026-11-19' }),
      totals: z.object({
        views: z.number().int(),
        visitors: z.number().int().meta({
          description: 'Visitantes únicos por dia (hash diário, sem cookie).',
        }),
        clicks: z.number().int(),
        clickRate: z
          .number()
          .meta({ description: 'Cliques por visita, 0 a 1.' }),
      }),
      daily: z.array(
        z.object({
          day: z.string(),
          views: z.number().int(),
          clicks: z.number().int(),
        }),
      ),
      links: z.array(
        z.object({
          linkId: z.string(),
          title: z.string(),
          clicks: z.number().int(),
          exists: z.boolean().meta({
            description: '`false` quando o item foi removido da página.',
          }),
        }),
      ),
      referrers: z.array(count),
      sources: z.array(count).meta({ description: 'Valores de `utm_source`.' }),
      countries: z.array(count),
      devices: z.array(count),
    })
    .meta({ description: 'Métricas anônimas de uma página de link da bio.' }),
)
