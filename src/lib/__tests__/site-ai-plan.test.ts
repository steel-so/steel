import { describe, expect, it } from 'vitest'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import { defaultSiteTheme } from '@/src/lib/canvas-site/theme'
import {
  buildPlanTheme,
  inferKit,
  MAX_SECTIONS_PER_PAGE,
  normalizePlan,
  requestedKinds,
  SITE_PLAN_JSON_SCHEMA,
  type SitePlanOutput,
  SitePlanOutputSchema,
} from '@/src/lib/site-ai/plan'
import type { GenerateSiteDTO } from '@/src/schemas/site-ai.schema'

type Brief = Pick<
  GenerateSiteDTO,
  'name' | 'pages' | 'style' | 'primaryColor' | 'goal'
>

const brief = (overrides: Partial<Brief> = {}): Brief => ({
  name: 'Pão & Cia',
  pages: ['about', 'contact'],
  style: 'auto',
  goal: 'leads',
  ...overrides,
})

const NONE = { products: false, testimonials: false, event: false }
const ALL = { products: true, testimonials: true, event: true }

const answer = (overrides: Partial<SitePlanOutput> = {}): SitePlanOutput => ({
  siteName: '  Pão   & Cia  ',
  tagline: 'Pão fresco todo dia',
  ctaLabel: 'Peça agora',
  style: 'saas',
  palette: {
    primary: '#AA3300',
    secondary: '#00ff00',
    accent: 'red',
    dark: '#101010',
  },
  fonts: { heading: 'serif', body: 'comic-sans' },
  pages: [
    {
      kind: 'home',
      title: 'Início',
      sections: ['hero', 'services', 'services', 'bogus', 'contact'],
    },
    { kind: 'about', title: 'Nossa história', sections: ['about', 'products'] },
    { kind: 'contact', title: 'Fale conosco', sections: ['faq'] },
  ],
  ...overrides,
})

describe('plan output schema', () => {
  it('accepts a model answer and describes every required key', () => {
    expect(SitePlanOutputSchema.safeParse(answer()).success).toBe(true)
    expect(SITE_PLAN_JSON_SCHEMA.required).toContain('pages')
  })
})

describe('normalizePlan', () => {
  it('keeps what the brief allows and fixes the rest', () => {
    const plan = normalizePlan(answer(), brief(), NONE)
    expect(plan.kit).toBe('saas')
    expect(plan.siteName).toBe('Pão & Cia')
    expect(plan.ctaLabel).toBe('Peça agora')
    expect(plan.colors).toEqual({
      primary: '#aa3300',
      secondary: '#00ff00',
      accent: SITE_KITS.saas.theme.colors.accent,
      dark: '#101010',
    })
    expect(plan.fonts).toEqual({
      heading: 'serif',
      body: SITE_KITS.saas.theme.fonts.body,
    })
    expect(plan.pages.map((page) => page.kind)).toEqual([
      'home',
      'about',
      'contact',
    ])
    // Home: the form lives on the contact page, so no contact here.
    expect(plan.pages[0]).toEqual({
      kind: 'home',
      title: 'Início',
      slug: 'inicio',
      sections: ['hero', 'services'],
    })
    // Products are not available: dropped; intro opens inner pages.
    expect(plan.pages[1].sections).toEqual(['intro', 'about'])
    expect(plan.pages[1].title).toBe('Nossa história')
    expect(plan.pages[2].sections).toEqual(['intro', 'faq', 'contact'])
  })

  it('falls back to defaults without an answer', () => {
    const plan = normalizePlan(
      null,
      brief({ pages: ['services', 'faq'], goal: 'sales' }),
      NONE,
    )
    expect(plan.kit).toBe('agency')
    expect(plan.siteName).toBe('Pão & Cia')
    expect(plan.tagline).toBe('Pão & Cia')
    expect(plan.ctaLabel).toBe('Quero comprar')
    expect(plan.colors.primary).toBe(SITE_KITS.agency.theme.colors.primary)
    // Without a contact page the home page ends with the form.
    expect(plan.pages[0].sections).toEqual([
      'hero',
      'services',
      'about',
      'contact',
    ])
    expect(plan.pages[1]).toMatchObject({
      title: 'Serviços',
      slug: 'servicos',
      sections: ['intro', 'services', 'steps', 'cta'],
    })
    expect(plan.pages[2].sections).toEqual(['intro', 'faq', 'cta'])
    expect(normalizePlan(null, brief({ goal: 'event' }), NONE).ctaLabel).toBe(
      'Garantir minha vaga',
    )
    expect(
      normalizePlan(null, brief({ goal: 'institutional' }), NONE).ctaLabel,
    ).toBe('Fale com a gente')
  })

  it('honours the chosen style and brand color over the model', () => {
    const plan = normalizePlan(
      answer({
        palette: {
          primary: '#000000',
          secondary: 'x',
          accent: 'y',
          dark: '#eeeeee',
        },
      }),
      brief({ style: 'b2b', primaryColor: '#FFCC00' }),
      NONE,
    )
    expect(plan.kit).toBe('b2b')
    expect(plan.colors.primary).toBe('#ffcc00')
    // A light "dark" is replaced by the kit's.
    expect(plan.colors.dark).toBe(SITE_KITS.b2b.theme.colors.dark)
  })

  it('adds the data sections the brief asks for and caps the page', () => {
    const plan = normalizePlan(
      answer({
        style: 'unknown',
        pages: [
          {
            kind: 'home',
            title: '',
            sections: [
              'services',
              'features',
              'about',
              'steps',
              'testimonials',
              'pricing',
              'faq',
              'cta',
            ],
          },
          { kind: 'products', title: 'Loja', sections: ['faq'] },
        ],
      }),
      brief({ pages: ['products'] }),
      ALL,
    )
    expect(plan.kit).toBe('agency')
    const home = plan.pages[0]
    expect(home.title).toBe('Início')
    expect(home.sections).toHaveLength(MAX_SECTIONS_PER_PAGE)
    expect(home.sections[0]).toBe('hero')
    expect(home.sections[1]).toBe('countdown')
    expect(home.sections.at(-1)).toBe('contact')
    expect(home.sections).not.toContain('cta')
    expect(plan.pages[1].sections).toEqual(['intro', 'products', 'faq'])
  })

  it('caps a page whose last section is not the form', () => {
    const plan = normalizePlan(
      answer({
        pages: [
          {
            kind: 'home',
            title: 'Início',
            sections: [
              'services',
              'features',
              'about',
              'steps',
              'testimonials',
              'pricing',
              'faq',
              'cta',
            ],
          },
        ],
      }),
      brief({ pages: ['contact'] }),
      ALL,
    )
    expect(plan.pages[0].sections).toHaveLength(MAX_SECTIONS_PER_PAGE)
    expect(plan.pages[0].sections.at(-1)).not.toBe('contact')
  })

  it('lists the requested kinds with home first', () => {
    expect(requestedKinds({ pages: ['faq', 'about'] })).toEqual([
      'home',
      'faq',
      'about',
    ])
  })
})

describe('buildPlanTheme / inferKit', () => {
  it('applies palette and fonts, with dark text on light brand colors', () => {
    const plan = normalizePlan(null, brief({ primaryColor: '#ffee00' }), NONE)
    const theme = buildPlanTheme(plan)
    expect(theme.colors.primary).toBe('#ffee00')
    expect(theme.buttons.primary.text).toBe('token:dark')

    const dark = buildPlanTheme(
      normalizePlan(null, brief({ primaryColor: '#123456' }), NONE),
    )
    expect(dark.buttons.primary.text).toBe('token:inverse')
  })

  it('reads the kit back from the button radius', () => {
    expect(inferKit(SITE_KITS.saas.theme)).toBe('saas')
    expect(inferKit(SITE_KITS.b2b.theme)).toBe('b2b')
    expect(inferKit(defaultSiteTheme())).toBe('agency')
  })
})
