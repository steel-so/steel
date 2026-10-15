import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do editor de sites (site-ui) — `types/site-studio.d.ts`. */

const CHANGE = z.object({
  id: z.string(),
  name: z.string().meta({ example: 'Sobre' }),
  change: z.enum(['added', 'changed', 'removed']),
})

export const SiteChangesDTOSchema = dto(
  'SiteChanges',
  z
    .object({
      firstPublish: z.boolean(),
      publishedAt: z.iso.datetime().nullable(),
      pages: z.array(CHANGE),
      globals: z.array(CHANGE),
      structure: z.boolean(),
      theme: z.boolean(),
      settings: z.boolean(),
      total: z.number().int().meta({ example: 3 }),
    })
    .meta({
      description:
        'O que a próxima publicação muda no site no ar: páginas e globais novos, alterados ou removidos, ordem/hierarquia, tema e configurações.',
    }),
)

export const SiteMediaItemDTOSchema = dto(
  'SiteMediaItem',
  z.object({
    id: z
      .string()
      .meta({ example: '3f0c8a52-5a1e-4c55-9d0a-0c9f2f1b7a10.webp' }),
    url: z.string().meta({
      example:
        'https://media.example.com/site-media/ws1/3f0c8a52-5a1e-4c55-9d0a-0c9f2f1b7a10.webp',
    }),
    size: z.number().int().meta({ example: 182_304 }),
    source: z.enum(['site', 'landing']),
    uploadedAt: z.iso.datetime().nullable(),
  }),
)
