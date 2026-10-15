import { z } from 'zod'
import { CollectionFieldSchema } from '@/src/lib/sites/blog/collections'
import { SitePostSeoSchema } from '@/src/schemas/site-blog.schema'
import { dto } from '../../common'

/** DTOs do blog e das coleções dos sites — `types/site-blog.d.ts`. */

const TERM_REF = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})
const STATUS = z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED'])
const PLATE = z
  .array(z.record(z.string(), z.unknown()))
  .meta({ description: 'Valor do editor Plate (blocos).' })

export const SitePostSummaryDTOSchema = dto(
  'SitePostSummary',
  z.object({
    id: z.string(),
    siteId: z.string(),
    title: z.string().meta({ example: 'Como escolher um plano de internet' }),
    slug: z.string().meta({ example: 'como-escolher-um-plano' }),
    excerpt: z.string().nullable(),
    coverImageUrl: z.string().nullable(),
    status: STATUS,
    featured: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    readingMinutes: z.number().int(),
    author: TERM_REF.nullable(),
    categories: z.array(TERM_REF),
    tags: z.array(TERM_REF),
    path: z.string().meta({ example: '/blog/como-escolher-um-plano' }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const SitePostDTOSchema = dto(
  'SitePost',
  SitePostSummaryDTOSchema.extend({
    content: PLATE,
    coverImageAlt: z.string().nullable(),
    wordCount: z.number().int(),
    seo: SitePostSeoSchema,
    createdById: z.string(),
    updatedById: z.string().nullable(),
  }),
)

export const SitePostPageDTOSchema = dto(
  'SitePostPage',
  z.object({
    items: z.array(SitePostSummaryDTOSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

export const SiteBlogCategoryDTOSchema = dto(
  'SiteBlogCategory',
  z.object({
    id: z.string(),
    siteId: z.string(),
    name: z.string().meta({ example: 'Dicas' }),
    slug: z.string().meta({ example: 'dicas' }),
    description: z.string().nullable(),
    position: z.number().int(),
    postCount: z.number().int(),
  }),
)

export const SiteBlogTagDTOSchema = dto(
  'SiteBlogTag',
  z.object({
    id: z.string(),
    siteId: z.string(),
    name: z.string().meta({ example: 'marketing' }),
    slug: z.string(),
    postCount: z.number().int(),
  }),
)

export const SiteAuthorDTOSchema = dto(
  'SiteAuthor',
  z.object({
    id: z.string(),
    siteId: z.string(),
    userId: z.string().nullable(),
    name: z.string().meta({ example: 'Ana Souza' }),
    slug: z.string().meta({ example: 'ana-souza' }),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    links: z.array(z.object({ network: z.string(), url: z.string() })),
    postCount: z.number().int(),
  }),
)

export const SiteBulkPostsResultDTOSchema = dto(
  'SiteBulkPostsResult',
  z.object({ affected: z.number().int() }),
)

export const SiteBlogAiResultDTOSchema = dto(
  'SiteBlogAiResult',
  z.object({
    action: z.enum(['write', 'summary', 'titles', 'faq']),
    title: z.string().optional(),
    excerpt: z.string().optional(),
    description: z.string().optional(),
    content: PLATE.optional(),
    titles: z.array(z.string()).optional(),
    faq: z
      .array(z.object({ question: z.string(), answer: z.string() }))
      .optional(),
  }),
)

export const SiteCmsPreviewDTOSchema = dto(
  'SiteCmsPreview',
  z.object({
    blog: z.object({
      posts: z.array(z.record(z.string(), z.unknown())),
      categories: z.array(z.record(z.string(), z.unknown())),
      tags: z.array(z.record(z.string(), z.unknown())),
      authors: z.array(z.record(z.string(), z.unknown())),
    }),
    collections: z.record(z.string(), z.record(z.string(), z.unknown())),
    post: z.record(z.string(), z.unknown()).nullable(),
    sample: z.boolean(),
  }),
)

export const SiteCollectionDTOSchema = dto(
  'SiteCollection',
  z.object({
    id: z.string(),
    siteId: z.string(),
    name: z.string().meta({ example: 'Vagas' }),
    itemName: z.string().meta({ example: 'Vaga' }),
    slug: z.string().meta({ example: 'vagas' }),
    fields: z.array(CollectionFieldSchema),
    templateGlobalId: z.string().nullable(),
    itemCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const SiteCollectionItemDTOSchema = dto(
  'SiteCollectionItem',
  z.object({
    id: z.string(),
    collectionId: z.string(),
    title: z.string().meta({ example: 'Desenvolvedor(a) back-end' }),
    slug: z.string(),
    data: z.record(z.string(), z.unknown()),
    status: z.enum(['DRAFT', 'PUBLISHED']),
    position: z.number().int(),
    publishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)
