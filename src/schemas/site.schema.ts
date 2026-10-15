import z from 'zod'
import {
  isValidPageSlug,
  isValidSiteSlug,
  SITE_SLUG_MAX,
} from '@/src/lib/sites/slug'

/** Absolute http(s) URL or a same-origin path (`/media/…`); never
 * `javascript:` or `data:`. */
export const SiteUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^(https?:\/\/|\/(?!\/))/i.test(value), {
    message: 'Use um endereço http(s) ou um caminho começando com /',
  })

export const SiteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(SITE_SLUG_MAX)
  .refine(isValidSiteSlug, {
    message:
      'Use de 3 a 63 letras minúsculas, números ou hífens (sem nomes reservados)',
  })

export const SitePageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidPageSlug, {
    message: 'Use letras minúsculas, números e hífens (até 80 caracteres)',
  })

/**
 * Theme of the `site` catalog. TODO(sites-integration): replace with the
 * catalog's theme schema (src/lib/canvas-site) once it lands; until then any
 * JSON object up to 64 KB is stored as-is.
 */
export const SiteThemeSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 64_000, {
    message: 'O tema é grande demais',
  })

export type SiteThemeDTO = z.infer<typeof SiteThemeSchema>

const TrackingSchema = z.object({
  googleAnalyticsId: z
    .string()
    .trim()
    .regex(/^G-[A-Z0-9]{4,20}$/, 'ID do Google Analytics inválido (G-XXXX)')
    .optional(),
  googleTagManagerId: z
    .string()
    .trim()
    .regex(/^GTM-[A-Z0-9]{4,12}$/, 'ID do Tag Manager inválido (GTM-XXXX)')
    .optional(),
  metaPixelId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'ID do Pixel da Meta inválido')
    .optional(),
})

const CookieBannerSchema = z.object({
  enabled: z.boolean().default(false),
  message: z.string().trim().max(400).optional(),
  policyUrl: SiteUrlSchema.optional(),
})

/** Site-wide settings: SEO defaults, icons, tracking ids, cookie banner. */
export const SiteSettingsSchema = z.object({
  seo: z
    .object({
      /** `%s` is replaced by the page title (`%s | Clínica São Lucas`). */
      titleTemplate: z.string().trim().max(120).optional(),
      description: z.string().trim().max(320).optional(),
      noindex: z.boolean().optional(),
    })
    .default({}),
  faviconUrl: SiteUrlSchema.optional(),
  socialImageUrl: SiteUrlSchema.optional(),
  tracking: TrackingSchema.default({}),
  cookieBanner: CookieBannerSchema.default({ enabled: false }),
})

export type SiteSettingsDTO = z.infer<typeof SiteSettingsSchema>

export const DEFAULT_SITE_SETTINGS: SiteSettingsDTO = SiteSettingsSchema.parse(
  {},
)

/** Settings read back from the database: anything malformed falls back to
 * the defaults instead of breaking the site. */
export function parseSiteSettings(value: unknown): SiteSettingsDTO {
  const parsed = SiteSettingsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : DEFAULT_SITE_SETTINGS
}

export const CreateSiteSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  /** Optional: derived from the name (with a numeric suffix) when absent. */
  slug: SiteSlugSchema.optional(),
  theme: SiteThemeSchema.optional(),
  settings: SiteSettingsSchema.optional(),
})

export type CreateSiteDTO = z.infer<typeof CreateSiteSchema>

export const UpdateSiteSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120).optional(),
    slug: SiteSlugSchema.optional(),
    theme: SiteThemeSchema.optional(),
    settings: SiteSettingsSchema.optional(),
    homePageId: z.string().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateSiteDTO = z.infer<typeof UpdateSiteSchema>
