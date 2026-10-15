import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do gerador de sites com IA (S4) — `types/site-ai.d.ts`. */

const usd = (example: number) => z.number().meta({ example })

export const SiteAiContextDTOSchema = dto(
  'SiteAiContext',
  z
    .object({
      available: z.boolean(),
      unavailableReason: z.string().nullable(),
      brand: z.object({
        companyName: z.string().meta({ example: 'Padaria Pão & Cia' }),
        logoUrl: z.string(),
        primaryColor: z.string().meta({ example: '#AA3300' }),
        website: z.string(),
      }),
      products: z.array(
        z.object({
          id: z.string(),
          name: z.string().meta({ example: 'Pão de fermentação natural' }),
          description: z.string(),
          price: z.string().meta({ example: 'R$ 18,00' }),
        }),
      ),
      testimonials: z.number().int().meta({ example: 2 }),
      forms: z.array(
        z.object({ id: z.string(), name: z.string(), publicToken: z.string() }),
      ),
      canCreateForm: z.boolean(),
      quota: z.object({
        usedUsd: usd(2.35),
        quotaUsd: usd(50),
        remainingUsd: usd(47.65),
        exceeded: z.boolean(),
      }),
      estimate: z
        .object({
          planUsd: usd(0.017),
          pageUsd: usd(0.04),
          sectionUsd: usd(0.03),
          rewriteUsd: usd(0.047),
          imagesUsd: usd(0.022),
          model: z.string().meta({ example: 'Claude Sonnet 4.5' }),
        })
        .nullable(),
    })
    .meta({
      description:
        'Dados que preenchem o formulário "Gerar com IA" (marca do e-mail, produtos do CRM, formulários publicados, depoimentos das landing pages), a cota mensal de IA e o custo estimado de cada ação com o modelo do workspace.',
    }),
)

const fragment = z
  .object({
    rootId: z.string(),
    nodes: z.record(z.string(), z.unknown()),
  })
  .meta({
    description:
      'Fragmento do Steel Canvas (uma `site.section` do catálogo `site`), validado pelo catálogo. O editor insere com ids novos.',
  })

export const SiteAiSectionResultDTOSchema = dto(
  'SiteAiSectionResult',
  z.object({
    reply: z.string().meta({ example: 'Três serviços em cartões.' }),
    fragment,
    costUsd: usd(0.024),
  }),
)

export const SiteAiRewriteResultDTOSchema = dto(
  'SiteAiRewriteResult',
  z.object({
    changes: z.array(
      z.object({
        nodeId: z.string(),
        set: z.record(z.string(), z.unknown()).meta({
          description:
            'Props de primeiro nível do nó, prontas para uma operação `update`.',
        }),
      }),
    ),
    rewritten: z.number().int().meta({ example: 12 }),
    costUsd: usd(0.031),
  }),
)

export const SiteAiImagesResultDTOSchema = dto(
  'SiteAiImagesResult',
  z.object({
    suggestions: z.array(
      z.object({
        nodeId: z.string(),
        currentSrc: z.string(),
        src: z.string(),
        alt: z.string().meta({ example: 'Padeiro tirando pães do forno' }),
        idea: z.string(),
        source: z.enum(['library', 'placeholder', 'current']),
        dimensions: z
          .object({ width: z.number().int(), height: z.number().int() })
          .nullable(),
      }),
    ),
    costUsd: usd(0.012),
  }),
)
