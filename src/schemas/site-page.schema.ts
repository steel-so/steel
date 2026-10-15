import z from 'zod'
import {
  SiteAbsoluteUrlSchema,
  SitePageSlugSchema,
  SiteUrlSchema,
} from './site.schema'
import { SearchContentSchema } from './site-search.schema'

/** `<changefreq>` values of the sitemap protocol. */
export const SITEMAP_CHANGE_FREQUENCIES = [
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
] as const

/** Per-page SEO; empty fields fall back to the site defaults. */
export const SitePageSeoSchema = z.object({
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(320).optional(),
  /** Social image; without one (and without the site's) the runtime draws
   * a card with the page title (`/_og`). */
  socialImageUrl: SiteUrlSchema.optional(),
  noindex: z.boolean().optional(),
  /** Canonical address when the content lives elsewhere (defaults to the
   * page's own URL). */
  canonicalUrl: SiteAbsoluteUrlSchema.optional(),
  /** Sitemap `<priority>` (0.0–1.0). */
  sitemapPriority: z.number().min(0).max(1).optional(),
  /** Sitemap `<changefreq>`. */
  changeFrequency: z.enum(SITEMAP_CHANGE_FREQUENCIES).optional(),
  /** "Buscadores" data (keyword, questions, summary, structured data). A
   * malformed block reads as absent. */
  search: SearchContentSchema.optional().catch(undefined),
})

export type SitePageSeoDTO = z.infer<typeof SitePageSeoSchema>

export function parseSitePageSeo(value: unknown): SitePageSeoDTO {
  const parsed = SitePageSeoSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : {}
}

/** Canvas document envelope (`CanvasDocument`); the service validates the
 * tree against the `site` catalog. */
export const SiteDocumentInputSchema = z.object({
  catalog: z.string(),
  version: z.number(),
  rootId: z.string(),
  nodes: z.record(z.string(), z.unknown()),
})

export const CreateSitePageSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório').max(120),
  /** Optional: derived from the title when absent. */
  slug: SitePageSlugSchema.optional(),
  parentId: z.string().min(1).nullable().optional(),
  /** Optional: a blank page when absent. */
  document: SiteDocumentInputSchema.optional(),
  seo: SitePageSeoSchema.optional(),
})

export type CreateSitePageDTO = z.infer<typeof CreateSitePageSchema>

export const UpdateSitePageSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório').max(120).optional(),
    slug: SitePageSlugSchema.optional(),
    parentId: z.string().min(1).nullable().optional(),
    document: SiteDocumentInputSchema.optional(),
    seo: SitePageSeoSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateSitePageDTO = z.infer<typeof UpdateSitePageSchema>

export const ReorderSitePagesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(500),
})

export type ReorderSitePagesDTO = z.infer<typeof ReorderSitePagesSchema>

export const DuplicateSitePageSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
})

export type DuplicateSitePageDTO = z.infer<typeof DuplicateSitePageSchema>
