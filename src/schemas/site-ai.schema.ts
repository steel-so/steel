import z from 'zod'
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
    /** Use the testimonials of the workspace's landing pages. */
    useTestimonials: z.boolean().default(true),
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
