import z from 'zod'
import { RESERVED_POST_SLUGS } from '@/src/lib/sites/blog/routes'
import { SitePageSlugSchema, SiteUrlSchema } from './site.schema'
import { SitePageSeoSchema } from './site-page.schema'

/**
 * Blog of a site (slice site-blog): posts, categories, tags, author
 * profiles and the AI helpers. Post SEO is the per-page SEO model plus the
 * "Buscadores" block (`seo.search`), whose questions are the post's FAQ
 * (rendered as an accordion and a FAQPage).
 */

export const POST_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const
export type SitePostStatusDTO = (typeof POST_STATUSES)[number]

export const SiteFaqItemSchema = z.object({
  question: z.string().trim().min(1, 'Escreva a pergunta').max(300),
  answer: z.string().trim().min(1, 'Escreva a resposta').max(2000),
})
export type SiteFaqItemDTO = z.infer<typeof SiteFaqItemSchema>

/**
 * "Buscadores" data of a post, stored at `seo.search` with the same shape
 * the site-search slice gives pages (`SearchContentSchema`): focus keyword,
 * synonyms, the questions the post answers (its FAQ) and a quotable
 * summary. Unknown keys set by the Buscadores panel are kept.
 */
export const SitePostSearchSchema = z
  .object({
    focusKeyword: z.string().trim().max(100).optional(),
    synonyms: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
    questions: z.array(SiteFaqItemSchema).max(20).optional(),
    summary: z.string().trim().max(600).optional(),
  })
  .passthrough()

/** Post SEO: the per-page SEO model (same fields and fallbacks) plus the
 * shared `search` block. */
export const SitePostSeoSchema = SitePageSeoSchema.extend({
  search: SitePostSearchSchema.optional(),
})
export type SitePostSeoDTO = z.infer<typeof SitePostSeoSchema>

/** FAQ of a post (its "questions this content answers"). */
export function postFaqOf(
  seo: SitePostSeoDTO,
): Array<{ question: string; answer: string }> {
  return (seo.search?.questions ?? []).filter(
    (item) => item.question && item.answer,
  )
}

export function parseSitePostSeo(value: unknown): SitePostSeoDTO {
  const parsed = SitePostSeoSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : {}
}

export const SitePostSlugSchema = SitePageSlugSchema.refine(
  (slug) => !RESERVED_POST_SLUGS.has(slug),
  { message: 'Esse endereço é reservado pelo blog' },
)

/** Plate editor value (blocks); the service renders it to HTML. */
export const PlateValueSchema = z
  .array(z.record(z.string(), z.unknown()))
  .max(5000)
  .refine((value) => JSON.stringify(value).length <= 2_000_000, {
    message: 'O conteúdo do post é grande demais',
  })

const isoDate = z.coerce.date()

const postFields = {
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  slug: SitePostSlugSchema,
  excerpt: z.string().trim().max(400).nullable(),
  content: PlateValueSchema,
  coverImageUrl: SiteUrlSchema.nullable(),
  coverImageAlt: z.string().trim().max(300).nullable(),
  authorId: z.string().min(1).max(64).nullable(),
  categoryIds: z.array(z.string().min(1).max(64)).max(20),
  tagIds: z.array(z.string().min(1).max(64)).max(30),
  /** New tags created on the fly (by name). */
  newTags: z.array(z.string().trim().min(1).max(60)).max(30),
  status: z.enum(POST_STATUSES),
  /** Publication date; `null` with PUBLISHED means now. */
  publishedAt: isoDate.nullable(),
  featured: z.boolean(),
  seo: SitePostSeoSchema,
}

export const CreateSitePostSchema = z.object({
  title: postFields.title,
  slug: postFields.slug.optional(),
  excerpt: postFields.excerpt.optional(),
  content: postFields.content.optional(),
  coverImageUrl: postFields.coverImageUrl.optional(),
  coverImageAlt: postFields.coverImageAlt.optional(),
  authorId: postFields.authorId.optional(),
  categoryIds: postFields.categoryIds.optional(),
  tagIds: postFields.tagIds.optional(),
  newTags: postFields.newTags.optional(),
  status: postFields.status.optional(),
  publishedAt: postFields.publishedAt.optional(),
  featured: postFields.featured.optional(),
  seo: postFields.seo.optional(),
})
export type CreateSitePostDTO = z.infer<typeof CreateSitePostSchema>

export const UpdateSitePostSchema = CreateSitePostSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nada para atualizar' },
)
export type UpdateSitePostDTO = z.infer<typeof UpdateSitePostSchema>

export const ListSitePostsQuerySchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  categoryId: z.string().min(1).max(64).optional(),
  tagId: z.string().min(1).max(64).optional(),
  authorId: z.string().min(1).max(64).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListSitePostsQueryDTO = z.infer<typeof ListSitePostsQuerySchema>

export const BULK_POST_ACTIONS = [
  'publish',
  'draft',
  'delete',
  'feature',
  'unfeature',
  'addCategory',
  'removeCategory',
] as const

export const BulkSitePostsSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(200),
    action: z.enum(BULK_POST_ACTIONS),
    categoryId: z.string().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      !['addCategory', 'removeCategory'].includes(value.action) ||
      Boolean(value.categoryId),
    { message: 'Escolha a categoria', path: ['categoryId'] },
  )
export type BulkSitePostsDTO = z.infer<typeof BulkSitePostsSchema>

// ─── categories and tags ──────────────────────────────────────────────────

export const CreateSiteBlogCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(80),
  slug: SitePageSlugSchema.optional(),
  description: z.string().trim().max(400).nullable().optional(),
})
export type CreateSiteBlogCategoryDTO = z.infer<
  typeof CreateSiteBlogCategorySchema
>

export const UpdateSiteBlogCategorySchema =
  CreateSiteBlogCategorySchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    { message: 'Nada para atualizar' },
  )
export type UpdateSiteBlogCategoryDTO = z.infer<
  typeof UpdateSiteBlogCategorySchema
>

export const CreateSiteBlogTagSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(60),
  slug: SitePageSlugSchema.optional(),
})
export type CreateSiteBlogTagDTO = z.infer<typeof CreateSiteBlogTagSchema>

export const UpdateSiteBlogTagSchema = CreateSiteBlogTagSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nada para atualizar' },
)
export type UpdateSiteBlogTagDTO = z.infer<typeof UpdateSiteBlogTagSchema>

// ─── authors ──────────────────────────────────────────────────────────────

export const AUTHOR_NETWORKS = [
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'github',
  'pinterest',
  'threads',
  'site',
] as const

export const SiteAuthorLinkSchema = z.object({
  network: z.enum(AUTHOR_NETWORKS),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => /^https?:\/\/[^\s/]+/i.test(value), {
      message: 'Use um endereço completo começando com https://',
    }),
})
export type SiteAuthorLinkDTO = z.infer<typeof SiteAuthorLinkSchema>

export function parseAuthorLinks(value: unknown): SiteAuthorLinkDTO[] {
  const parsed = z
    .array(SiteAuthorLinkSchema)
    .max(10)
    .safeParse(value ?? [])
  return parsed.success ? parsed.data : []
}

export const CreateSiteAuthorSchema = z.object({
  /** Workspace member behind the profile (optional: guest authors). */
  userId: z.string().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  slug: SitePageSlugSchema.optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  avatarUrl: SiteUrlSchema.nullable().optional(),
  links: z.array(SiteAuthorLinkSchema).max(10).optional(),
})
export type CreateSiteAuthorDTO = z.infer<typeof CreateSiteAuthorSchema>

export const UpdateSiteAuthorSchema = CreateSiteAuthorSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nada para atualizar' },
)
export type UpdateSiteAuthorDTO = z.infer<typeof UpdateSiteAuthorSchema>

// ─── AI ───────────────────────────────────────────────────────────────────

export const BLOG_AI_ACTIONS = ['write', 'summary', 'titles', 'faq'] as const
export type SiteBlogAiAction = (typeof BLOG_AI_ACTIONS)[number]

export const SiteBlogAiSchema = z
  .object({
    action: z.enum(BLOG_AI_ACTIONS),
    /** Topic (write) or the current title. */
    topic: z.string().trim().max(300).optional(),
    /** Outline or instructions (write). */
    outline: z.string().trim().max(4000).optional(),
    focusKeyword: z.string().trim().max(80).optional(),
    tone: z.enum(['profissional', 'descontraido', 'tecnico']).optional(),
    /** Current text of the post (summary, titles, faq). */
    text: z.string().max(40_000).optional(),
  })
  .refine(
    (value) =>
      value.action === 'write'
        ? Boolean(value.topic)
        : Boolean(value.text?.trim()),
    {
      message: 'Escreva o assunto do post (ou o texto, para resumir)',
    },
  )
export type SiteBlogAiDTO = z.infer<typeof SiteBlogAiSchema>

export const BlogAiOutputSchema = z.object({
  title: z.string().default(''),
  excerpt: z.string().default(''),
  /** Markdown body (write). */
  body: z.string().default(''),
  titles: z.array(z.string()).default([]),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .default([]),
  description: z.string().default(''),
})
export type BlogAiOutput = z.infer<typeof BlogAiOutputSchema>
