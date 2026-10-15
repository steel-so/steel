import z from 'zod'

/**
 * "Buscadores" of the site builder: SEO (Google/Bing), AEO (answer
 * engines) and GEO (generative engines). Two stored shapes, both inside
 * existing JSON columns (no migration):
 *
 * - `SiteSearchSettingsSchema` → `sites.settings.search`: the business
 *   profile, crawler access per bot, IndexNow, verification tags and the
 *   llms.txt switch. Snapshotted on publish like every other setting.
 * - `SearchContentSchema` → `seo.search` of a page (and of a blog post: any
 *   content with a canvas document and its own `seo` JSON reuses it). Focus
 *   keyword, the questions it answers, the quotable summary and the
 *   structured data items.
 */

const text = (max: number) => z.string().trim().max(max)

/** Absolute http(s) URL or a same-origin path (`/media/…`). */
const urlOrPath = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^(https?:\/\/|\/(?!\/))/i.test(value), {
    message: 'Use um endereço http(s) ou um caminho começando com /',
  })

const absoluteUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^https?:\/\/[^\s/]+/i.test(value), {
    message: 'Use um endereço completo começando com https://',
  })

/** `YYYY-MM-DD` or a full ISO date-time. */
const isoDate = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(
        value,
      ) && !Number.isNaN(Date.parse(value)),
    { message: 'Use uma data válida (AAAA-MM-DD)' },
  )

const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM')

// ─── business profile ────────────────────────────────────────────────────

/** schema.org type of the business (Organization or a LocalBusiness). */
export const SITE_BUSINESS_TYPES = [
  'Organization',
  'LocalBusiness',
  'ProfessionalService',
  'MedicalBusiness',
  'Dentist',
  'LegalService',
  'AccountingService',
  'FinancialService',
  'RealEstateAgent',
  'Store',
  'Restaurant',
  'BeautySalon',
  'AutomotiveBusiness',
  'EducationalOrganization',
  'HomeAndConstructionBusiness',
  'SportsActivityLocation',
  'TravelAgency',
] as const

export type SiteBusinessType = (typeof SITE_BUSINESS_TYPES)[number]

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export const SiteBusinessHoursSchema = z.object({
  days: z.array(z.enum(WEEK_DAYS)).min(1).max(7),
  opens: time,
  closes: time,
})

export const SiteBusinessAddressSchema = z.object({
  street: text(200).optional(),
  district: text(120).optional(),
  city: text(120).optional(),
  /** State (UF). */
  region: text(60).optional(),
  postalCode: text(20).optional(),
  /** ISO 3166-1 alpha-2. */
  country: text(2).optional(),
})

export const SiteBusinessPersonSchema = z.object({
  name: text(120).min(1),
  role: text(120).optional(),
  url: absoluteUrl.optional(),
})

/**
 * The facts every engine uses about the business behind the site (NAP:
 * name, address, phone). Feeds the Organization/LocalBusiness node of every
 * page and the "Fatos" of llms.txt.
 */
export const SiteBusinessProfileSchema = z.object({
  type: z.enum(SITE_BUSINESS_TYPES).optional(),
  /** Brand name (what people search for). */
  name: text(120).optional(),
  /** Registered name (razão social). */
  legalName: text(160).optional(),
  description: text(600).optional(),
  /** Free category ("Clínica odontológica"). */
  category: text(120).optional(),
  address: SiteBusinessAddressSchema.optional(),
  geo: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
  phone: text(40).optional(),
  email: z.string().trim().email('E-mail inválido').max(200).optional(),
  hours: z.array(SiteBusinessHoursSchema).max(14).optional(),
  /** Cities, states or regions served. */
  serviceArea: z.array(text(120).min(1)).max(30).optional(),
  foundingYear: z.number().int().min(1800).max(2100).optional(),
  logoUrl: urlOrPath.optional(),
  /** Official profiles (Instagram, LinkedIn, Google Business…). */
  sameAs: z.array(absoluteUrl).max(15).optional(),
  people: z.array(SiteBusinessPersonSchema).max(10).optional(),
  /** `$`, `$$`, `R$ 100–300`. */
  priceRange: text(40).optional(),
})

export type SiteBusinessProfileDTO = z.infer<typeof SiteBusinessProfileSchema>

// ─── crawlers ────────────────────────────────────────────────────────────

/** Crawlers with their own switch in robots.txt. `purpose` drives the
 * explanation: search (shows the site in answers) or training (feeds model
 * training only). */
export const SITE_CRAWLER_BOTS = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'Google-Extended',
  'CCBot',
] as const

export type SiteCrawlerBot = (typeof SITE_CRAWLER_BOTS)[number]

/** `false` blocks the bot; absent means allowed. */
export const SiteCrawlerSettingsSchema = z
  .partialRecord(z.enum(SITE_CRAWLER_BOTS), z.boolean())
  .default({})

// ─── site-level settings ─────────────────────────────────────────────────

export const SiteSearchSettingsSchema = z.object({
  business: SiteBusinessProfileSchema.default({}),
  crawlers: SiteCrawlerSettingsSchema,
  /** `/llms.txt` and `/llms-full.txt` (on by default). */
  llms: z
    .object({
      enabled: z.boolean().default(true),
      /** Extra paragraph for AI assistants (what to highlight). */
      notes: text(1000).optional(),
    })
    .default({ enabled: true }),
  /** Pings IndexNow (Bing, Yandex…) with the site's URLs on every publish. */
  indexNow: z
    .object({
      enabled: z.boolean().default(false),
      /** Generated by the server when first enabled (8–128 hex chars). */
      key: z
        .string()
        .regex(/^[a-f0-9]{8,128}$/)
        .optional(),
    })
    .default({ enabled: false }),
  /** Ownership verification `<meta>` tags. */
  verification: z
    .object({
      google: text(120)
        .regex(/^[\w-]*$/, 'Cole só o código (content) da meta tag')
        .optional(),
      bing: text(120)
        .regex(/^[\w-]*$/, 'Cole só o código (content) da meta tag')
        .optional(),
    })
    .default({}),
})

export type SiteSearchSettingsDTO = z.infer<typeof SiteSearchSettingsSchema>

export const DEFAULT_SITE_SEARCH_SETTINGS: SiteSearchSettingsDTO =
  SiteSearchSettingsSchema.parse({})

/** Stored search settings; anything malformed falls back to the defaults. */
export function parseSiteSearchSettings(value: unknown): SiteSearchSettingsDTO {
  const parsed = SiteSearchSettingsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : DEFAULT_SITE_SEARCH_SETTINGS
}

/** Body of `PUT …/search`: every block optional (only what is sent
 * changes). The IndexNow key is server-owned. */
export const UpdateSiteSearchSettingsSchema = z
  .object({
    business: SiteBusinessProfileSchema.optional(),
    crawlers: z
      .partialRecord(z.enum(SITE_CRAWLER_BOTS), z.boolean())
      .optional(),
    llms: z
      .object({ enabled: z.boolean(), notes: text(1000).optional() })
      .optional(),
    indexNow: z.object({ enabled: z.boolean() }).optional(),
    verification: z
      .object({
        google: text(120)
          .regex(/^[\w-]*$/, 'Cole só o código (content) da meta tag')
          .optional(),
        bing: text(120)
          .regex(/^[\w-]*$/, 'Cole só o código (content) da meta tag')
          .optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateSiteSearchSettingsDTO = z.infer<
  typeof UpdateSiteSearchSettingsSchema
>

// ─── structured data (per content) ───────────────────────────────────────

const offer = {
  price: z.number().min(0).max(1_000_000_000).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Moeda em 3 letras (BRL)')
    .optional(),
}

export const ArticleDataSchema = z.object({
  type: z.literal('Article'),
  headline: text(110).optional(),
  authorName: text(120).optional(),
  datePublished: isoDate.optional(),
  image: urlOrPath.optional(),
})

export const ProductDataSchema = z.object({
  type: z.literal('Product'),
  /** CRM product the fields were copied from (kept for "Atualizar"). */
  crmProductId: text(40).optional(),
  name: text(150).optional(),
  description: text(1000).optional(),
  sku: text(80).optional(),
  brand: text(120).optional(),
  image: urlOrPath.optional(),
  availability: z.enum(['InStock', 'OutOfStock', 'PreOrder']).optional(),
  ...offer,
})

export const ServiceDataSchema = z.object({
  type: z.literal('Service'),
  name: text(150).optional(),
  description: text(1000).optional(),
  serviceType: text(120).optional(),
  areaServed: text(200).optional(),
  ...offer,
})

export const EventDataSchema = z.object({
  type: z.literal('Event'),
  name: text(150).optional(),
  description: text(1000).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  attendance: z.enum(['offline', 'online', 'mixed']).optional(),
  locationName: text(150).optional(),
  locationAddress: text(300).optional(),
  url: absoluteUrl.optional(),
  image: urlOrPath.optional(),
  ...offer,
})

export const HowToDataSchema = z.object({
  type: z.literal('HowTo'),
  name: text(150).optional(),
  description: text(1000).optional(),
  /** ISO 8601 duration (`PT30M`). */
  totalTime: z
    .string()
    .trim()
    .regex(/^P(T?\d+[HMSD])+$/, 'Use a duração ISO (PT30M)')
    .optional(),
  steps: z
    .array(z.object({ name: text(150).optional(), text: text(600) }))
    .max(30)
    .optional(),
})

/** FAQPage from the page's accordions and its questions. */
export const FaqDataSchema = z.object({ type: z.literal('FAQPage') })

/** LocalBusiness from the business profile. */
export const LocalBusinessDataSchema = z.object({
  type: z.literal('LocalBusiness'),
})

export const StructuredDataItemSchema = z.discriminatedUnion('type', [
  ArticleDataSchema,
  ProductDataSchema,
  ServiceDataSchema,
  EventDataSchema,
  HowToDataSchema,
  FaqDataSchema,
  LocalBusinessDataSchema,
])

export type StructuredDataItem = z.infer<typeof StructuredDataItemSchema>
export type StructuredDataType = StructuredDataItem['type']

export const STRUCTURED_DATA_TYPES: StructuredDataType[] = [
  'Article',
  'Product',
  'Service',
  'Event',
  'HowTo',
  'FAQPage',
  'LocalBusiness',
]

// ─── per content ─────────────────────────────────────────────────────────

export const SearchQuestionSchema = z.object({
  question: text(300).min(1, 'Escreva a pergunta'),
  /** Direct answer (ideal: 40–60 words). */
  answer: text(2000),
})

export type SearchQuestionDTO = z.infer<typeof SearchQuestionSchema>

/**
 * Search data of one piece of content (a site page today, a blog post
 * next). Stored at `seo.search`; every field optional.
 */
export const SearchContentSchema = z.object({
  /** Main query the content should rank for. */
  focusKeyword: text(100).optional(),
  /** Variations and synonyms (count as the keyword in the checks). */
  synonyms: z.array(text(100).min(1)).max(8).optional(),
  /** "Perguntas que este conteúdo responde" (FAQPage + llms.txt). */
  questions: z.array(SearchQuestionSchema).max(20).optional(),
  /** Quotable summary (llms.txt, `abstract`, speakable). 1–3 sentences. */
  summary: text(600).optional(),
  /** Marks title and description as speakable (voice assistants). */
  speakable: z.boolean().optional(),
  /** Shows "Atualizado em …" at the end of the published page. */
  showUpdatedDate: z.boolean().optional(),
  structuredData: z.array(StructuredDataItemSchema).max(10).optional(),
})

export type SearchContentDTO = z.infer<typeof SearchContentSchema>

/** Stored search data of a page; malformed data reads as empty. */
export function parseSearchContent(value: unknown): SearchContentDTO {
  const parsed = SearchContentSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : {}
}

// ─── requests ────────────────────────────────────────────────────────────

export const SearchAiSummarySchema = z.object({
  pageId: z.string().min(1),
})

export type SearchAiSummaryDTO = z.infer<typeof SearchAiSummarySchema>

export const SEARCH_AI_FIELDS = ['title', 'description', 'answers'] as const
export type SearchAiField = (typeof SEARCH_AI_FIELDS)[number]

export const SearchAiOptimizeSchema = z.object({
  pageIds: z.array(z.string().min(1)).min(1).max(10),
  fields: z.array(z.enum(SEARCH_AI_FIELDS)).min(1),
})

export type SearchAiOptimizeDTO = z.infer<typeof SearchAiOptimizeSchema>

/** Applies reviewed suggestions (title, description, answers). */
export const SearchApplySchema = z.object({
  items: z
    .array(
      z.object({
        pageId: z.string().min(1),
        title: text(120).min(1).optional(),
        description: text(320).min(1).optional(),
        questions: z.array(SearchQuestionSchema).max(20).optional(),
      }),
    )
    .min(1)
    .max(10),
})

export type SearchApplyDTO = z.infer<typeof SearchApplySchema>
