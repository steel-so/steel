import type {
  CanvasBackground,
  CanvasRadius,
  CanvasShadow,
} from '@/src/lib/canvas/values'
import { defaultSiteTheme, type SiteTheme } from '../theme'

/**
 * The three visual styles of the ready-made sections, taken from the
 * landing-page kits (`app/_components/crm/landing-page/sections/*`):
 *
 * - **agency** ("Agência", kits Agency/Job site): airy, centered headings,
 *   red overline, colorful cards with deep shadows, mist bands.
 * - **b2b** ("Corporativo", kits B2B/Consultation): left-aligned, bordered
 *   cards, tight corners, ink-dark bands for emphasis.
 * - **saas** ("Produto digital", kits SaaS/Mobile app/Web app): gradient
 *   hero, pill buttons, soft rounded cards, navy footer.
 *
 * Presets only reference theme tokens, so any of them works with any site
 * theme; `theme` is the one a full-page template of the style ships with.
 */

export type SiteKitId = 'agency' | 'b2b' | 'saas'

export interface SiteKit {
  id: SiteKitId
  label: string
  theme: SiteTheme
  /** Section headings and intro text. */
  headAlign: 'left' | 'center'
  /** Background of alternate (tinted) bands. */
  band: CanvasBackground
  /** Emphasis band (CTA, footer) and its text color. */
  dark: CanvasBackground
  /** Hero band and its text color. */
  hero: CanvasBackground
  heroText?: string
  /** Card look. */
  card: {
    background: CanvasBackground
    radius: CanvasRadius
    shadow?: CanvasShadow
    border?: { width: number; style: 'solid'; color: string }
  }
  /** Corners of photos. */
  photo: CanvasRadius
  /** Icon chip colors, cycled per card. */
  chips: string[]
  /** Overline color. */
  overline: string
}

const r = (value: number): CanvasRadius => ({
  topLeft: value,
  topRight: value,
  bottomRight: value,
  bottomLeft: value,
})

function agencyTheme(): SiteTheme {
  return defaultSiteTheme()
}

function b2bTheme(): SiteTheme {
  const theme = defaultSiteTheme()
  theme.buttons.radius = 4
  theme.radius = { sm: 2, md: 6, lg: 10 }
  theme.text.overline.letterSpacing = 1.2
  theme.buttons.secondary = {
    background: 'token:inverse',
    text: 'token:dark',
    border: 'token:inverse',
    hoverBackground: 'token:surface',
    hoverText: 'token:dark',
  }
  theme.colors.surface = '#f8f8f8'
  return theme
}

function saasTheme(): SiteTheme {
  const theme = defaultSiteTheme()
  theme.colors.primary = '#7b11f9'
  theme.colors.accent = '#f74d4d'
  theme.colors.dark = '#1e2541'
  theme.buttons.radius = 999
  theme.buttons.paddingX = 32
  theme.radius = { sm: 8, md: 16, lg: 28 }
  theme.buttons.secondary = {
    background: 'token:inverse',
    text: 'token:primary',
    border: 'token:inverse',
    hoverBackground: 'token:surface',
    hoverText: 'token:primary',
  }
  return theme
}

export const SITE_KITS: Record<SiteKitId, SiteKit> = {
  agency: {
    id: 'agency',
    label: 'Agência',
    theme: agencyTheme(),
    headAlign: 'center',
    band: { kind: 'color', color: 'token:surface' },
    dark: { kind: 'color', color: 'token:dark' },
    hero: { kind: 'color', color: 'token:background' },
    card: {
      background: { kind: 'color', color: 'token:background' },
      radius: r(10),
      shadow: { x: 0, y: 32, blur: 54, spread: 0, color: '#161c2d29' },
    },
    photo: r(10),
    chips: ['token:secondary', 'token:primary', 'token:accent'],
    overline: 'token:accent',
  },
  b2b: {
    id: 'b2b',
    label: 'Corporativo',
    theme: b2bTheme(),
    headAlign: 'left',
    band: { kind: 'color', color: 'token:surface' },
    dark: { kind: 'color', color: 'token:dark' },
    hero: { kind: 'color', color: 'token:surface' },
    card: {
      background: { kind: 'color', color: 'token:background' },
      radius: r(6),
      border: { width: 1, style: 'solid', color: 'token:border' },
    },
    photo: r(6),
    chips: ['token:primary', 'token:primary', 'token:primary'],
    overline: 'token:primary',
  },
  saas: {
    id: 'saas',
    label: 'Produto digital',
    theme: saasTheme(),
    headAlign: 'center',
    band: { kind: 'color', color: 'token:surface' },
    dark: { kind: 'gradient', angle: 234, from: '#313c59', to: 'token:dark' },
    hero: {
      kind: 'gradient',
      angle: 211,
      from: 'token:primary',
      to: '#3636b2',
    },
    heroText: 'token:inverse',
    card: {
      background: { kind: 'color', color: 'token:background' },
      radius: r(20),
      shadow: { x: 0, y: 16, blur: 40, spread: -12, color: '#1e254133' },
    },
    photo: r(20),
    chips: ['token:primary', 'token:secondary', 'token:accent'],
    overline: 'token:primary',
  },
}

export const SITE_KIT_IDS = Object.keys(SITE_KITS) as SiteKitId[]
