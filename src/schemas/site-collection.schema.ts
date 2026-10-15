import z from 'zod'
import { CollectionFieldsSchema } from '@/src/lib/sites/blog/collections'
import { RESERVED_COLLECTION_SLUGS } from '@/src/lib/sites/blog/routes'
import { SitePageSlugSchema } from './site.schema'

/**
 * Collections of a site (custom content types like cases, equipe, vagas,
 * imóveis): typed fields and items. Item values are validated against the
 * fields by the service (`parseItemData`).
 */

export {
  type CollectionField,
  CollectionFieldSchema,
  CollectionFieldsSchema,
} from '@/src/lib/sites/blog/collections'

export const SiteCollectionSlugSchema = SitePageSlugSchema.refine(
  (slug) => !RESERVED_COLLECTION_SLUGS.has(slug),
  { message: 'Esse endereço é reservado' },
)

export const CreateSiteCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(80),
  /** Singular name of an item ("Caso", "Vaga"). */
  itemName: z.string().trim().min(1).max(60).optional(),
  slug: SiteCollectionSlugSchema.optional(),
  fields: CollectionFieldsSchema.default([]),
})
export type CreateSiteCollectionDTO = z.input<typeof CreateSiteCollectionSchema>

export const UpdateSiteCollectionSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(80).optional(),
    itemName: z.string().trim().min(1).max(60).optional(),
    slug: SiteCollectionSlugSchema.optional(),
    fields: CollectionFieldsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })
export type UpdateSiteCollectionDTO = z.infer<typeof UpdateSiteCollectionSchema>

export const COLLECTION_ITEM_STATUSES = ['DRAFT', 'PUBLISHED'] as const

export const CreateSiteCollectionItemSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  slug: SitePageSlugSchema.optional(),
  data: z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= 200_000, {
      message: 'O item é grande demais',
    })
    .default({}),
  status: z.enum(COLLECTION_ITEM_STATUSES).optional(),
})
export type CreateSiteCollectionItemDTO = z.input<
  typeof CreateSiteCollectionItemSchema
>

export const UpdateSiteCollectionItemSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório').max(200).optional(),
    slug: SitePageSlugSchema.optional(),
    data: z
      .record(z.string(), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 200_000, {
        message: 'O item é grande demais',
      })
      .optional(),
    status: z.enum(COLLECTION_ITEM_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })
export type UpdateSiteCollectionItemDTO = z.infer<
  typeof UpdateSiteCollectionItemSchema
>

export const ReorderSiteCollectionItemsSchema = z.object({
  orderedIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
})
export type ReorderSiteCollectionItemsDTO = z.infer<
  typeof ReorderSiteCollectionItemsSchema
>
