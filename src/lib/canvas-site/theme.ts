import { z } from 'zod'
import {
  type CanvasColorToken,
  canvasColorSchema,
  canvasShadowSchema,
  TEXT_TRANSFORMS,
} from '@/src/lib/canvas/values'
import { SITE_MEDIA, SITE_ROOT_CLASS } from './constants'
import { cssValue } from './css-value'

/**
 * Site theme: palette tokens, typography presets, buttons, links, spacing
 * scale, corner radii, shadows and content width. Stored as `Site.theme`
 * (JSON) and compiled to CSS custom properties + base rules scoped to
 * `.s-site`. Node props reference palette colors as `token:<id>`, which
 * resolve to `var(--canvas-<id>)` — so a theme change never changes the
 * class names of the document, only this stylesheet.
 */

// ─── palette ──────────────────────────────────────────────────────────────

export const SITE_COLOR_IDS = [
  'primary',
  'secondary',
  'accent',
  'dark',
  'text',
  'muted',
  'background',
  'surface',
  'border',
  'inverse',
] as const
export type SiteColorId = (typeof SITE_COLOR_IDS)[number]

export const SITE_COLOR_LABELS: Record<SiteColorId, string> = {
  primary: 'Primária',
  secondary: 'Secundária',
  accent: 'Destaque',
  dark: 'Escura',
  text: 'Texto',
  muted: 'Texto suave',
  background: 'Fundo',
  surface: 'Superfície',
  border: 'Borda',
  inverse: 'Texto sobre escuro',
}

/** A literal color (`#RGB`, `#RRGGBB`, `#RRGGBBAA`). Theme colors cannot
 * reference other tokens. */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)

const paletteSchema = z.object(
  Object.fromEntries(SITE_COLOR_IDS.map((id) => [id, hexColor])) as Record<
    SiteColorId,
    typeof hexColor
  >,
)

// ─── fonts ────────────────────────────────────────────────────────────────

/**
 * Font stacks offered by the theme. The CSP of the app only allows
 * same-origin fonts (`font-src 'self'`), so S1 offers Geist (self-hosted by
 * the app) and system stacks; self-hosted Google families come later.
 */
export const SITE_FONTS = [
  {
    id: 'geist',
    label: 'Geist',
    stack:
      'var(--font-geist-sans), "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: 'system',
    label: 'Sistema',
    stack:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: 'humanist',
    label: 'Humanista',
    stack:
      '"Seravek", "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
  },
  {
    id: 'serif',
    label: 'Serifada',
    stack:
      '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, Georgia, serif',
  },
  {
    id: 'slab',
    label: 'Clássica',
    stack: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
  },
  {
    id: 'mono',
    label: 'Monoespaçada',
    stack:
      'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
  },
] as const
export type SiteFontId = (typeof SITE_FONTS)[number]['id']

const fontIdSchema = z.enum(
  SITE_FONTS.map((font) => font.id) as [SiteFontId, ...SiteFontId[]],
)

export function fontStack(id: SiteFontId): string {
  return (SITE_FONTS.find((font) => font.id === id) ?? SITE_FONTS[0]).stack
}

// ─── typography presets ───────────────────────────────────────────────────

export const SITE_TEXT_PRESETS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'lead',
  'body',
  'small',
  'overline',
] as const
export type SiteTextPreset = (typeof SITE_TEXT_PRESETS)[number]

export const SITE_TEXT_PRESET_LABELS: Record<SiteTextPreset, string> = {
  h1: 'Título 1',
  h2: 'Título 2',
  h3: 'Título 3',
  h4: 'Título 4',
  h5: 'Título 5',
  h6: 'Título 6',
  lead: 'Destaque',
  body: 'Corpo',
  small: 'Pequeno',
  overline: 'Sobretítulo',
}

const fontSize = z.number().min(8).max(200)

const textStyleSchema = z.object({
  font: z.enum(['heading', 'body']),
  size: z.object({
    base: fontSize,
    tablet: fontSize.optional(),
    mobile: fontSize.optional(),
  }),
  weight: z.number().int().min(100).max(900),
  lineHeight: z.number().min(0.8).max(3),
  /** In px. */
  letterSpacing: z.number().min(-10).max(20),
  transform: z.enum(TEXT_TRANSFORMS),
})
export type SiteTextStyle = z.infer<typeof textStyleSchema>

// ─── buttons and links ────────────────────────────────────────────────────

export const SITE_BUTTON_VARIANTS = [
  'primary',
  'secondary',
  'outline',
  'link',
] as const
export type SiteButtonVariant = (typeof SITE_BUTTON_VARIANTS)[number]

const buttonColorsSchema = z.object({
  background: canvasColorSchema,
  text: canvasColorSchema,
  border: canvasColorSchema,
  hoverBackground: canvasColorSchema,
  hoverText: canvasColorSchema,
})

const buttonsSchema = z.object({
  radius: z.number().min(0).max(999),
  paddingX: z.number().min(0).max(80),
  paddingY: z.number().min(0).max(40),
  fontSize: z.number().min(10).max(40),
  fontWeight: z.number().int().min(100).max(900),
  letterSpacing: z.number().min(-5).max(10),
  transform: z.enum(TEXT_TRANSFORMS),
  borderWidth: z.number().min(0).max(8),
  primary: buttonColorsSchema,
  secondary: buttonColorsSchema,
  outline: buttonColorsSchema,
})

const linksSchema = z.object({
  color: canvasColorSchema,
  hoverColor: canvasColorSchema,
  underline: z.enum(['always', 'hover', 'none']),
})

// ─── scales ───────────────────────────────────────────────────────────────

export const SITE_SPACE_STEPS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const
export type SiteSpaceStep = (typeof SITE_SPACE_STEPS)[number]

const space = z.number().min(0).max(400)
const radius = z.number().min(0).max(999)
const shadow = canvasShadowSchema.unwrap()

// ─── theme ────────────────────────────────────────────────────────────────

export const siteThemeSchema = z.object({
  colors: paletteSchema,
  fonts: z.object({ heading: fontIdSchema, body: fontIdSchema }),
  text: z.object(
    Object.fromEntries(
      SITE_TEXT_PRESETS.map((preset) => [preset, textStyleSchema]),
    ) as Record<SiteTextPreset, typeof textStyleSchema>,
  ),
  buttons: buttonsSchema,
  links: linksSchema,
  spacing: z.object(
    Object.fromEntries(SITE_SPACE_STEPS.map((step) => [step, space])) as Record<
      SiteSpaceStep,
      typeof space
    >,
  ),
  radius: z.object({ sm: radius, md: radius, lg: radius }),
  shadows: z.object({ sm: shadow, md: shadow, lg: shadow }),
  /** Max width of boxed sections, in px. */
  contentWidth: z.number().min(480).max(2400),
})
export type SiteTheme = z.infer<typeof siteThemeSchema>

const heading = (
  base: number,
  tablet: number,
  mobile: number,
  weight = 700,
  lineHeight = 1.2,
  letterSpacing = 0,
): SiteTextStyle => ({
  font: 'heading',
  size: { base, tablet, mobile },
  weight,
  lineHeight,
  letterSpacing,
  transform: 'none',
})

/** The default theme: the "Shade Pro" palette of the landing-page kits
 * (ink #161c2d, indigo #473bf0), Geist and an 8-px rhythm. */
export function defaultSiteTheme(): SiteTheme {
  return {
    colors: {
      primary: '#473bf0',
      secondary: '#68d585',
      accent: '#f64b4b',
      dark: '#161c2d',
      text: '#161c2d',
      muted: '#5c6272',
      background: '#ffffff',
      surface: '#f4f7fa',
      border: '#e7e9ed',
      inverse: '#ffffff',
    },
    fonts: { heading: 'geist', body: 'geist' },
    text: {
      h1: heading(64, 52, 38, 700, 1.1, -1.5),
      h2: heading(44, 38, 30, 700, 1.15, -1),
      h3: heading(32, 28, 24, 700, 1.25, -0.5),
      h4: heading(24, 22, 20, 700, 1.3, -0.3),
      h5: heading(20, 19, 18, 700, 1.4, 0),
      h6: heading(17, 17, 16, 700, 1.4, 0),
      lead: {
        font: 'body',
        size: { base: 21, tablet: 19, mobile: 18 },
        weight: 400,
        lineHeight: 1.6,
        letterSpacing: 0,
        transform: 'none',
      },
      body: {
        font: 'body',
        size: { base: 17 },
        weight: 400,
        lineHeight: 1.7,
        letterSpacing: 0,
        transform: 'none',
      },
      small: {
        font: 'body',
        size: { base: 14 },
        weight: 400,
        lineHeight: 1.6,
        letterSpacing: 0,
        transform: 'none',
      },
      overline: {
        font: 'body',
        size: { base: 13 },
        weight: 700,
        lineHeight: 1.4,
        letterSpacing: 1.6,
        transform: 'uppercase',
      },
    },
    buttons: {
      radius: 8,
      paddingX: 28,
      paddingY: 14,
      fontSize: 17,
      fontWeight: 700,
      letterSpacing: -0.3,
      transform: 'none',
      borderWidth: 1,
      primary: {
        background: 'token:primary',
        text: 'token:inverse',
        border: 'token:primary',
        hoverBackground: 'token:dark',
        hoverText: 'token:inverse',
      },
      secondary: {
        background: 'token:dark',
        text: 'token:inverse',
        border: 'token:dark',
        hoverBackground: 'token:primary',
        hoverText: 'token:inverse',
      },
      outline: {
        background: 'transparent',
        text: 'token:text',
        border: 'token:border',
        hoverBackground: 'token:surface',
        hoverText: 'token:text',
      },
    },
    links: {
      color: 'token:primary',
      hoverColor: 'token:dark',
      underline: 'hover',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 32, xl: 64, xxl: 120 },
    radius: { sm: 4, md: 10, lg: 20 },
    shadows: {
      sm: { x: 0, y: 1, blur: 3, spread: 0, color: '#161c2d1f' },
      md: { x: 0, y: 12, blur: 32, spread: -8, color: '#161c2d29' },
      lg: { x: 0, y: 32, blur: 54, spread: 0, color: '#161c2d29' },
    },
    contentWidth: 1200,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch
  }
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(base, key)) out[key] = deepMerge(base[key], value)
  }
  return out
}

/**
 * A complete theme from stored or partial input: the input is merged over
 * the defaults (unknown keys dropped) and every field that fails the schema
 * falls back to its default, so an old or hand-edited theme never breaks
 * a page.
 */
export function parseSiteTheme(input: unknown): SiteTheme {
  const defaults = defaultSiteTheme()
  const merged = deepMerge(defaults, input)
  const parsed = siteThemeSchema.safeParse(merged)
  if (parsed.success) return parsed.data
  // Reset only the invalid leaves (their paths come from the issues).
  const repaired = structuredClone(merged) as Record<string, unknown>
  for (const issue of parsed.error.issues) {
    resetPath(repaired, defaults, issue.path as Array<string | number>)
  }
  const second = siteThemeSchema.safeParse(repaired)
  return second.success ? second.data : defaults
}

function resetPath(
  target: Record<string, unknown>,
  defaults: unknown,
  path: Array<string | number>,
) {
  let node: Record<string, unknown> = target
  let source = defaults as Record<string, unknown>
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(node[key]) || !isPlainObject(source?.[key])) {
      node[key] = structuredClone(source?.[key])
      return
    }
    node = node[key] as Record<string, unknown>
    source = source[key] as Record<string, unknown>
  }
  const last = path[path.length - 1]
  if (last === undefined) return
  node[last] = structuredClone(source?.[last])
}

/** Palette as the color tokens offered by the editor's color controls. */
export function siteColorTokens(theme: SiteTheme): CanvasColorToken[] {
  return SITE_COLOR_IDS.map((id) => ({
    id,
    label: SITE_COLOR_LABELS[id],
    value: theme.colors[id],
  }))
}

// ─── theme stylesheet ─────────────────────────────────────────────────────

/** `token:x` → `var(--canvas-x)`; literal colors pass through. */
export function themeColor(color: string): string {
  return color.startsWith('token:')
    ? `var(--canvas-${color.slice('token:'.length)})`
    : color
}

function shadowValue(value: SiteTheme['shadows']['sm']): string {
  return `${value.inset ? 'inset ' : ''}${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${themeColor(value.color)}`
}

function textRule(style: SiteTextStyle, size: number): string {
  return [
    `font-family:var(--s-font-${style.font})`,
    `font-size:${size}px`,
    `font-weight:${style.weight}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}px`,
    `text-transform:${style.transform}`,
  ].join(';')
}

/**
 * The theme stylesheet: custom properties, reset, typography presets
 * (`.s-t-<preset>`, with tablet/mobile sizes), buttons (`.s-btn-<variant>`)
 * and links, all scoped to `.s-site`. Deterministic for a given theme.
 */
export function compileThemeCss(theme: SiteTheme): string {
  const root = `.${SITE_ROOT_CLASS}`
  const vars: string[] = []
  for (const id of SITE_COLOR_IDS)
    vars.push(`--canvas-${id}:${theme.colors[id]}`)
  vars.push(`--s-font-heading:${cssValue(fontStack(theme.fonts.heading))}`)
  vars.push(`--s-font-body:${cssValue(fontStack(theme.fonts.body))}`)
  for (const step of SITE_SPACE_STEPS) {
    vars.push(`--s-space-${step}:${theme.spacing[step]}px`)
  }
  for (const key of ['sm', 'md', 'lg'] as const) {
    vars.push(`--s-radius-${key}:${theme.radius[key]}px`)
    vars.push(`--s-shadow-${key}:${shadowValue(theme.shadows[key])}`)
  }
  vars.push(`--s-content:${theme.contentWidth}px`)

  const b = theme.buttons
  const link = theme.links
  const rules: string[] = [
    `${root}{${vars.join(';')}}`,
    `${root}{background:var(--canvas-background);color:var(--canvas-text);${textRule(theme.text.body, theme.text.body.size.base)};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`,
    `${root} *,${root} *::before,${root} *::after{box-sizing:border-box}`,
    `${root} :where(h1,h2,h3,h4,h5,h6,p,figure,blockquote,ul,ol,dl){margin:0}`,
    `${root} :where(ul,ol){padding:0}`,
    `${root} :where(img,video,svg,iframe){display:block;max-width:100%}`,
    `${root} :where(img,video){height:auto}`,
    `${root} :where(button,input,select,textarea){font:inherit;color:inherit}`,
    `${root} :where(a){color:${themeColor(link.color)};text-decoration:${link.underline === 'always' ? 'underline' : 'none'};text-underline-offset:.2em}`,
    `${root} :where(a):hover{color:${themeColor(link.hoverColor)}${link.underline === 'hover' ? ';text-decoration:underline' : ''}}`,
    `${root} :where(:focus-visible){outline:2px solid var(--canvas-primary);outline-offset:2px}`,
    `${root} .s-rich :where(p+p,p+ul,p+ol,ul+p,ol+p){margin-top:.75em}`,
    `${root} .s-rich :where(ul,ol){padding-left:1.4em}`,
    `${root} .s-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
  ]
  const tablet: string[] = []
  const mobile: string[] = []
  for (const preset of SITE_TEXT_PRESETS) {
    const style = theme.text[preset]
    rules.push(
      `${root} :where(.s-t-${preset}){${textRule(style, style.size.base)}}`,
    )
    if (style.size.tablet !== undefined) {
      tablet.push(
        `${root} :where(.s-t-${preset}){font-size:${style.size.tablet}px}`,
      )
    }
    if (style.size.mobile !== undefined) {
      mobile.push(
        `${root} :where(.s-t-${preset}){font-size:${style.size.mobile}px}`,
      )
    }
  }
  rules.push(
    `${root} :where(.s-btn){display:inline-flex;align-items:center;justify-content:center;gap:.5em;padding:${b.paddingY}px ${b.paddingX}px;border-radius:${b.radius}px;border:${b.borderWidth}px solid transparent;font-family:var(--s-font-body);font-size:${b.fontSize}px;font-weight:${b.fontWeight};letter-spacing:${b.letterSpacing}px;text-transform:${b.transform};line-height:1.2;white-space:nowrap;text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s,border-color .15s}`,
    `${root} :where(.s-btn-sm){padding:${Math.round(b.paddingY * 0.6)}px ${Math.round(b.paddingX * 0.6)}px;font-size:${Math.max(12, b.fontSize - 3)}px}`,
    `${root} :where(.s-btn-lg){padding:${Math.round(b.paddingY * 1.3)}px ${Math.round(b.paddingX * 1.3)}px;font-size:${b.fontSize + 2}px}`,
  )
  for (const variant of ['primary', 'secondary', 'outline'] as const) {
    const colors = b[variant]
    rules.push(
      `${root} :where(.s-btn-${variant}){background:${themeColor(colors.background)};color:${themeColor(colors.text)};border-color:${themeColor(colors.border)}}`,
      `${root} :where(.s-btn-${variant}):hover{background:${themeColor(colors.hoverBackground)};color:${themeColor(colors.hoverText)};text-decoration:none}`,
    )
  }
  rules.push(
    `${root} :where(.s-btn-link){background:transparent;padding-left:0;padding-right:0;color:${themeColor(link.color)}}`,
    `${root} :where(.s-btn-link):hover{color:${themeColor(link.hoverColor)};text-decoration:underline}`,
  )
  if (tablet.length)
    rules.push(`@media ${SITE_MEDIA.tablet}{${tablet.join('')}}`)
  if (mobile.length)
    rules.push(`@media ${SITE_MEDIA.mobile}{${mobile.join('')}}`)
  return rules.join('\n')
}
