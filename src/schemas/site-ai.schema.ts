import z from 'zod'
import { AI_MODEL_KEYS } from '@/src/lib/ai/models'
import { SiteDocumentInputSchema } from './site-page.schema'

/**
 * Inputs of the AI site generator (S4): the guided brief of "Novo site →
 * Gerar com IA" and the three editor actions (generate a section, rewrite
 * the page copy, suggest images). Labels are the pt-BR strings of the UI.
 */

// ─── vocabularies ─────────────────────────────────────────────────────────

export const SITE_AI_GOALS = [
  'leads',
  'sales',
  'event',
  'institutional',
] as const
export type SiteAiGoal = (typeof SITE_AI_GOALS)[number]

export const SITE_AI_GOAL_LABELS: Record<SiteAiGoal, string> = {
  leads: 'Gerar contatos',
  sales: 'Vender',
  event: 'Divulgar um evento',
  institutional: 'Apresentar a empresa',
}

export const SITE_AI_TONES = [
  'professional',
  'friendly',
  'inspiring',
  'formal',
  'casual',
] as const
export type SiteAiTone = (typeof SITE_AI_TONES)[number]

export const SITE_AI_TONE_LABELS: Record<SiteAiTone, string> = {
  professional: 'Profissional',
  friendly: 'Próximo e amigável',
  inspiring: 'Inspirador',
  formal: 'Formal',
  casual: 'Descontraído',
}

/** Pages the user can ask for besides the home page (always generated). */
export const SITE_AI_PAGE_KINDS = [
  'about',
  'services',
  'products',
  'pricing',
  'faq',
  'contact',
] as const
export type SiteAiPageKind = (typeof SITE_AI_PAGE_KINDS)[number]

export const SITE_AI_PAGE_LABELS: Record<'home' | SiteAiPageKind, string> = {
  home: 'Início',
  about: 'Sobre',
  services: 'Serviços',
  products: 'Produtos',
  pricing: 'Planos e preços',
  faq: 'Perguntas frequentes',
  contact: 'Contato',
}

/** Visual style: one of the catalog kits, or let the AI pick. */
export const SITE_AI_STYLES = ['auto', 'agency', 'b2b', 'saas'] as const
export type SiteAiStyle = (typeof SITE_AI_STYLES)[number]

export const SITE_AI_STYLE_LABELS: Record<SiteAiStyle, string> = {
  auto: 'A IA escolhe',
  agency: 'Agência',
  b2b: 'Corporativo',
  saas: 'Produto digital',
}

export const SITE_AI_LENGTHS = ['shorter', 'same', 'longer'] as const
export type SiteAiLength = (typeof SITE_AI_LENGTHS)[number]

export const SITE_AI_LENGTH_LABELS: Record<SiteAiLength, string> = {
  shorter: 'Mais curto',
  same: 'Mesmo tamanho',
  longer: 'Mais completo',
}

/** Most pages and products one generation takes. */
export const SITE_AI_MAX_PRODUCTS = 6

/** Most inspiration links one generation reads (ADR 0071). */
export const SITE_AI_MAX_INSPIRATION_LINKS = 5

/** Most reference images one generation takes (vision input). */
export const SITE_AI_MAX_INSPIRATION_IMAGES = 4

/** Longest data URL of one reference image (~1 MB of image). The browser
 * downsizes the picture before sending. */
export const SITE_AI_MAX_INSPIRATION_IMAGE_CHARS = 1_400_000

// ─── shared pieces ────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')

/** https URL or a same-origin path; never `http:`, `javascript:`, `data:`. */
const logoUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^(https:\/\/|\/(?!\/))/i.test(value), {
    message: 'Use um endereço https ou um caminho começando com /',
  })

const id = z.string().trim().min(1).max(64)

/**
 * Inspiration link: `http(s)://host/...`, no credentials, standard ports.
 * Syntax only — the server-side reader re-checks the host, its DNS answer
 * and every redirect before any request (ADR 0071).
 */
export const InspirationLinkSchema = z
  .string()
  .trim()
  .min(1, 'Cole um endereço')
  .max(2000, 'Endereço longo demais')
  .refine(
    (value) => {
      try {
        const url = new URL(value)
        return (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          url.hostname.includes('.') &&
          !url.username &&
          !url.password &&
          (url.port === '' || url.port === '80' || url.port === '443')
        )
      } catch {
        return false
      }
    },
    { message: 'Use um endereço completo, como https://exemplo.com.br' },
  )

/** Reference image as a base64 `data:` URL (png, jpeg or webp). */
export const InspirationImageSchema = z
  .string()
  .max(SITE_AI_MAX_INSPIRATION_IMAGE_CHARS, 'Imagem grande demais')
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    'Use imagens PNG, JPEG ou WebP',
  )

// ─── "Gerar com IA" ───────────────────────────────────────────────────────

export const GenerateSiteSchema = z
  .object({
    /** Site name (also the company name used in the copy). */
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    business: z
      .string()
      .trim()
      .min(10, 'Conte em pelo menos uma frase o que a empresa faz')
      .max(1500),
    audience: z.string().trim().max(500).default(''),
    goal: z.enum(SITE_AI_GOALS),
    tone: z.enum(SITE_AI_TONES),
    pages: z
      .array(z.enum(SITE_AI_PAGE_KINDS))
      .max(SITE_AI_PAGE_KINDS.length)
      .default([])
      .transform((pages) => [...new Set(pages)]),
    style: z.enum(SITE_AI_STYLES).default('auto'),
    primaryColor: hexColor.optional(),
    logoUrl: logoUrl.optional(),
    /** CRM products shown on the site (real names and prices). */
    productIds: z.array(id).max(SITE_AI_MAX_PRODUCTS).default([]),
    /** Published CRM form for the contact section; absent = none. */
    contactFormId: id.optional(),
    /** Create (and publish) a "Contato pelo site" form instead. */
    createContactForm: z.boolean().default(false),
    /** `YYYY-MM-DD`, for the countdown of an event site. */
    eventDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
      .optional(),
    extra: z.string().trim().max(1000).default(''),
    /** Sites the AI takes as inspiration (structure and style, never the
     * copy). Duplicates are dropped. */
    inspirationLinks: z
      .array(InspirationLinkSchema)
      .max(
        SITE_AI_MAX_INSPIRATION_LINKS,
        `Até ${SITE_AI_MAX_INSPIRATION_LINKS} links de inspiração`,
      )
      .default([])
      .transform((links) => [...new Set(links)]),
    /** Screenshots or pictures the AI looks at as a reference (structure,
     * colors, style — never copied). */
    inspirationImages: z
      .array(InspirationImageSchema)
      .max(
        SITE_AI_MAX_INSPIRATION_IMAGES,
        `Até ${SITE_AI_MAX_INSPIRATION_IMAGES} imagens de inspiração`,
      )
      .default([]),
    /** What to take from the references ("cores", "estrutura", "tom"). */
    inspirationFocus: z.string().trim().max(300).default(''),
    /** Model chosen for this generation (`provider:model`); absent = the
     * workspace default. Must be enabled and usable in the workspace. */
    modelKey: z
      .enum(AI_MODEL_KEYS, { error: 'Modelo de IA desconhecido' })
      .optional(),
  })
  .refine((data) => !(data.contactFormId && data.createContactForm), {
    message: 'Escolha um formulário ou peça um novo, não os dois',
    path: ['contactFormId'],
  })

export type GenerateSiteDTO = z.infer<typeof GenerateSiteSchema>
export type GenerateSiteInput = z.input<typeof GenerateSiteSchema>

// ─── editor actions ───────────────────────────────────────────────────────

export const GenerateSiteSectionSchema = z.object({
  prompt: z.string().trim().min(3, 'Descreva a seção que você quer').max(1000),
  style: z.enum(SITE_AI_STYLES).default('auto'),
  /** Title of the page being edited (context for the copy). */
  pageTitle: z.string().trim().max(120).default(''),
  /** Headings already on the page, so the new section does not repeat
   * them. */
  headings: z.array(z.string().trim().max(200)).max(30).default([]),
})

export type GenerateSiteSectionDTO = z.infer<typeof GenerateSiteSectionSchema>
export type GenerateSiteSectionInput = z.input<typeof GenerateSiteSectionSchema>

/** Most nodes one rewrite or image suggestion may target. */
export const SITE_AI_MAX_TARGETS = 200

export const RewriteSitePageSchema = z.object({
  /** The page (or global) as it is in the editor, unsaved edits included. */
  document: SiteDocumentInputSchema,
  tone: z.enum(SITE_AI_TONES),
  length: z.enum(SITE_AI_LENGTHS).default('same'),
  instructions: z.string().trim().max(500).default(''),
  /** Only these nodes (and their descendants); empty = the whole page. */
  nodeIds: z.array(id).max(SITE_AI_MAX_TARGETS).default([]),
})

export type RewriteSitePageDTO = z.infer<typeof RewriteSitePageSchema>
export type RewriteSitePageInput = z.input<typeof RewriteSitePageSchema>

export const SuggestSiteImagesSchema = z.object({
  document: SiteDocumentInputSchema,
  nodeIds: z.array(id).max(SITE_AI_MAX_TARGETS).default([]),
})

export type SuggestSiteImagesDTO = z.infer<typeof SuggestSiteImagesSchema>
export type SuggestSiteImagesInput = z.input<typeof SuggestSiteImagesSchema>
