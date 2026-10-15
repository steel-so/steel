import { z } from 'zod'
import { SITE_KITS, type SiteKitId } from '@/src/lib/canvas-site/presets/kits'
import {
  SITE_FONTS,
  type SiteFontId,
  type SiteTheme,
} from '@/src/lib/canvas-site/theme'
import { luminance } from '@/src/lib/crm-email-builder/brand'
import {
  type GenerateSiteDTO,
  SITE_AI_PAGE_LABELS,
  type SiteAiPageKind,
} from '@/src/schemas/site-ai.schema'
import { SITE_AI_SECTIONS, type SiteAiSection } from './sections'

/**
 * Site plan: the first AI call of a generation picks the visual style,
 * palette, fonts, the call to action and the sections of every page. The
 * answer is advisory — `normalizePlan` keeps only what the brief allows and
 * fills every gap with defaults, so a poor answer still yields a sound
 * site.
 */

export type SitePageKind = 'home' | SiteAiPageKind

export const SITE_AI_KIT_IDS = ['agency', 'b2b', 'saas'] as const
const FONT_IDS = SITE_FONTS.map((font) => font.id) as [
  SiteFontId,
  ...SiteFontId[],
]

/** Page address of each kind. */
export const SITE_AI_PAGE_SLUGS: Record<SitePageKind, string> = {
  home: 'inicio',
  about: 'sobre',
  services: 'servicos',
  products: 'produtos',
  pricing: 'planos',
  faq: 'perguntas-frequentes',
  contact: 'contato',
}

/** Sections a page of each kind may hold (besides hero/intro/cta). */
const ALLOWED: Record<SitePageKind, SiteAiSection[]> = {
  home: [
    'hero',
    'services',
    'features',
    'about',
    'steps',
    'products',
    'testimonials',
    'pricing',
    'faq',
    'countdown',
    'cta',
    'contact',
  ],
  about: ['intro', 'about', 'features', 'steps', 'testimonials', 'cta'],
  services: ['intro', 'services', 'features', 'steps', 'faq', 'cta'],
  products: ['intro', 'products', 'features', 'faq', 'cta'],
  pricing: ['intro', 'pricing', 'products', 'faq', 'cta'],
  faq: ['intro', 'faq', 'cta'],
  contact: ['intro', 'contact', 'faq'],
}

/** Sections when the model gives none we can use. */
const DEFAULTS: Record<SitePageKind, SiteAiSection[]> = {
  home: ['hero', 'services', 'about', 'cta'],
  about: ['intro', 'about', 'features', 'cta'],
  services: ['intro', 'services', 'steps', 'cta'],
  products: ['intro', 'products', 'cta'],
  pricing: ['intro', 'pricing', 'faq', 'cta'],
  faq: ['intro', 'faq', 'cta'],
  contact: ['intro', 'contact'],
}

export const MAX_SECTIONS_PER_PAGE = 7

const STRING = { type: 'string' }

export const SitePlanOutputSchema = z.object({
  siteName: z.string(),
  tagline: z.string(),
  ctaLabel: z.string(),
  style: z.string(),
  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    dark: z.string(),
  }),
  fonts: z.object({ heading: z.string(), body: z.string() }),
  pages: z
    .array(
      z.object({
        kind: z.string(),
        title: z.string(),
        sections: z.array(z.string()),
      }),
    )
    .min(1),
})
export type SitePlanOutput = z.infer<typeof SitePlanOutputSchema>

export const SITE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'siteName',
    'tagline',
    'ctaLabel',
    'style',
    'palette',
    'fonts',
    'pages',
  ],
  properties: {
    siteName: STRING,
    tagline: STRING,
    ctaLabel: STRING,
    style: { type: 'string', enum: [...SITE_AI_KIT_IDS] },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'secondary', 'accent', 'dark'],
      properties: {
        primary: STRING,
        secondary: STRING,
        accent: STRING,
        dark: STRING,
      },
    },
    fonts: {
      type: 'object',
      additionalProperties: false,
      required: ['heading', 'body'],
      properties: {
        heading: { type: 'string', enum: FONT_IDS },
        body: { type: 'string', enum: FONT_IDS },
      },
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'sections'],
        properties: {
          kind: {
            type: 'string',
            enum: Object.keys(SITE_AI_PAGE_SLUGS),
          },
          title: STRING,
          sections: {
            type: 'array',
            items: { type: 'string', enum: [...SITE_AI_SECTIONS] },
          },
        },
      },
    },
  },
}

/** What the workspace has, deciding which data sections exist. */
export interface PlanAvailability {
  products: boolean
  testimonials: boolean
  event: boolean
}

export interface SitePlanPage {
  kind: SitePageKind
  title: string
  slug: string
  sections: SiteAiSection[]
}

export interface SitePlan {
  siteName: string
  tagline: string
  ctaLabel: string
  kit: SiteKitId
  colors: { primary: string; secondary: string; accent: string; dark: string }
  fonts: { heading: SiteFontId; body: SiteFontId }
  pages: SitePlanPage[]
}

const HEX = /^#[0-9a-fA-F]{6}$/

function hexOr(value: string | undefined, fallback: string): string {
  const color = value?.trim() ?? ''
  return HEX.test(color) ? color.toLowerCase() : fallback
}

function line(value: string | undefined, max: number, fallback: string) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return text || fallback
}

/** Kinds the user asked for, home first, in the brief's order. */
export function requestedKinds(dto: Pick<GenerateSiteDTO, 'pages'>) {
  return ['home', ...dto.pages] as SitePageKind[]
}

function sectionsFor(
  kind: SitePageKind,
  proposed: string[],
  availability: PlanAvailability,
  hasContactPage: boolean,
): SiteAiSection[] {
  const usable = (type: SiteAiSection) =>
    ALLOWED[kind].includes(type) &&
    (type !== 'products' || availability.products) &&
    (type !== 'testimonials' || availability.testimonials) &&
    (type !== 'countdown' || availability.event) &&
    // One form per site: on the contact page when there is one.
    (type !== 'contact' || kind === 'contact' || !hasContactPage)
  let sections = [
    ...new Set(
      proposed.filter((type): type is SiteAiSection =>
        (SITE_AI_SECTIONS as readonly string[]).includes(type),
      ),
    ),
  ].filter(usable)
  if (sections.length === 0) sections = DEFAULTS[kind].filter(usable)

  const opener: SiteAiSection = kind === 'home' ? 'hero' : 'intro'
  sections = [opener, ...sections.filter((type) => type !== opener)]
  if (kind === 'contact' && !sections.includes('contact')) {
    sections.push('contact')
  }
  // The data sections the user asked for are not dropped by the model.
  if (kind === 'products' && availability.products) {
    if (!sections.includes('products')) sections.splice(1, 0, 'products')
  }
  if (
    kind === 'home' &&
    availability.event &&
    !sections.includes('countdown')
  ) {
    sections.splice(1, 0, 'countdown')
  }
  // Without a contact page the home page ends with the CRM form.
  if (kind === 'home' && !hasContactPage && !sections.includes('contact')) {
    sections.push('contact')
  }
  // The contact section closes the page; a CTA right before it is noise.
  if (sections.includes('contact')) {
    sections = [
      ...sections.filter((type) => type !== 'contact' && type !== 'cta'),
      'contact',
    ]
  }
  return sections
}

/** Keeps the contact section when the cap cuts the list. */
function capSections(sections: SiteAiSection[]): SiteAiSection[] {
  if (sections.length <= MAX_SECTIONS_PER_PAGE) return sections
  const last = sections.at(-1) as SiteAiSection
  return last === 'contact'
    ? [...sections.slice(0, MAX_SECTIONS_PER_PAGE - 1), 'contact']
    : sections.slice(0, MAX_SECTIONS_PER_PAGE)
}

/** The plan the generator follows, from the model's answer (or none). */
export function normalizePlan(
  raw: SitePlanOutput | null,
  dto: Pick<
    GenerateSiteDTO,
    'name' | 'pages' | 'style' | 'primaryColor' | 'goal'
  >,
  availability: PlanAvailability,
): SitePlan {
  const kit: SiteKitId =
    dto.style !== 'auto'
      ? dto.style
      : (SITE_AI_KIT_IDS as readonly string[]).includes(raw?.style ?? '')
        ? (raw?.style as SiteKitId)
        : 'agency'
  const base = SITE_KITS[kit].theme
  const isFont = (value: string | undefined): value is SiteFontId =>
    (FONT_IDS as string[]).includes(value ?? '')

  let dark = hexOr(raw?.palette.dark, base.colors.dark)
  if (luminance(dark) > 0.08) dark = base.colors.dark

  const kinds = requestedKinds(dto)
  const hasContactPage = kinds.includes('contact')
  const pages = kinds.map((kind): SitePlanPage => {
    const proposed = raw?.pages.find((page) => page.kind === kind)
    return {
      kind,
      title: line(proposed?.title, 40, SITE_AI_PAGE_LABELS[kind]),
      slug: SITE_AI_PAGE_SLUGS[kind],
      sections: capSections(
        sectionsFor(
          kind,
          proposed?.sections ?? [],
          availability,
          hasContactPage,
        ),
      ),
    }
  })

  const defaultCta =
    dto.goal === 'sales'
      ? 'Quero comprar'
      : dto.goal === 'event'
        ? 'Garantir minha vaga'
        : 'Fale com a gente'

  return {
    siteName: line(raw?.siteName, 120, dto.name),
    tagline: line(raw?.tagline, 160, dto.name),
    ctaLabel: line(raw?.ctaLabel, 30, defaultCta),
    kit,
    colors: {
      primary: dto.primaryColor
        ? dto.primaryColor.toLowerCase()
        : hexOr(raw?.palette.primary, base.colors.primary),
      secondary: hexOr(raw?.palette.secondary, base.colors.secondary),
      accent: hexOr(raw?.palette.accent, base.colors.accent),
      dark,
    },
    fonts: {
      heading: isFont(raw?.fonts.heading)
        ? raw.fonts.heading
        : base.fonts.heading,
      body: isFont(raw?.fonts.body) ? raw.fonts.body : base.fonts.body,
    },
    pages,
  }
}

/** Kit theme with the plan's palette and fonts. Light brand colors get
 * dark button text so the label stays readable. */
export function buildPlanTheme(plan: SitePlan): SiteTheme {
  const theme = structuredClone(SITE_KITS[plan.kit].theme)
  theme.colors.primary = plan.colors.primary
  theme.colors.secondary = plan.colors.secondary
  theme.colors.accent = plan.colors.accent
  theme.colors.dark = plan.colors.dark
  theme.fonts = { ...plan.fonts }
  if (luminance(plan.colors.primary) > 0.5) {
    theme.buttons.primary.text = 'token:dark'
    theme.buttons.primary.hoverText = 'token:inverse'
  }
  return theme
}

/** Kit closest to a site theme (sections generated in the editor match
 * the site's look): pill buttons → saas, square → b2b, else agency. */
export function inferKit(theme: SiteTheme): SiteKitId {
  if (theme.buttons.radius >= 100) return 'saas'
  if (theme.buttons.radius <= 4) return 'b2b'
  return 'agency'
}
