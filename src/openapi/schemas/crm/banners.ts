import { z } from 'zod'
import {
  BANNER_OBJECTIVES,
  BannerAiCopySchema,
  BannerDocumentSchema,
} from '@/src/schemas/crm-banner.schema'
import { dto } from '../../common'

/** DTOs de Banners (`types/crm-banner.d.ts`). */

const dateTime = () => z.iso.datetime()

const bannerFields = {
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().meta({ example: 'Campanha de verão' }),
  folder: z.string().meta({ description: 'Pasta (vazio = sem pasta).' }),
  tags: z.array(z.string()),
  objective: z.enum(BANNER_OBJECTIVES).nullable(),
  createdById: z.string(),
  updatedById: z.string().nullable(),
  createdAt: dateTime(),
  updatedAt: dateTime(),
}

export const CrmBannerDTO = dto(
  'CrmBanner',
  z.object({ ...bannerFields, document: BannerDocumentSchema }).meta({
    description:
      'Banner com todos os formatos. Cada formato tem tamanho fixo em px e elementos (texto, botão, imagem, logo, forma) posicionados em px do próprio formato.',
  }),
)

export const CrmBannerListItemDTO = dto(
  'CrmBannerListItem',
  z
    .object({
      ...bannerFields,
      document: BannerDocumentSchema.meta({
        description: 'Só o formato de capa (miniatura).',
      }),
      formatCount: z.number().int(),
      formatIds: z.array(z.string()),
    })
    .meta({ description: 'Banner da lista da biblioteca.' }),
)

export const CrmBannerAiResultDTO = dto(
  'CrmBannerAiResult',
  z
    .object({
      variants: z.array(BannerAiCopySchema),
      imageIdea: z.string(),
    })
    .meta({
      description:
        'Textos sugeridos pela IA (uma opção em `BANNER`, várias em `VARIANTS`) e a ideia da imagem principal.',
    }),
)
