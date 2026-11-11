import { z } from 'zod'
import type { CanvasColorToken } from '@/src/lib/canvas/values'
import {
  fontStack,
  SITE_FONTS,
  type SiteFontId,
} from '@/src/lib/canvas-site/theme'
import type { DocumentSettingsDTO } from '@/src/schemas/document.schema'
import { DOCUMENT_PAGE_SIZES } from './constants'

/**
 * Theme of a document (`documents.theme`, stored as overrides): palette
 * (`token:<id>` in the color controls, `var(--canvas-<id>)` in the CSS),
 * fonts, text sizes, spacing, corners, content width and the page margin of
 * the paged layout and the PDF. `parseDocumentTheme` completes and corrects
 * any partial input, so a broken or old theme never breaks a render.
 */

export const DOCUMENT_COLOR_IDS = [
  'primary',
  'secondary',
  'accent',
  'heading',
  'text',
  'muted',
  'background',
  'surface',
  'border',
  'highlight',
  'inverse',
] as const
export type DocumentColorId = (typeof DOCUMENT_COLOR_IDS)[number]

export const DOCUMENT_COLOR_LABELS: Record<DocumentColorId, string> = {
  primary: 'Principal',
  secondary: 'Secundária',
  accent: 'Destaque',
  heading: 'Títulos',
  text: 'Texto',
  muted: 'Texto suave',
  background: 'Fundo da página',
  surface: 'Fundo do documento',
  border: 'Bordas',
  highlight: 'Seções em destaque',
  inverse: 'Texto sobre a cor principal',
}

/** Same families as the site theme: the app CSP serves fonts only from its
 * own origin, so the editor and the public link use these stacks. */
export const DOCUMENT_FONTS = SITE_FONTS
export type DocumentFontId = SiteFontId

const hexSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const fontIdSchema = z.enum(
  SITE_FONTS.map((font) => font.id) as [SiteFontId, ...SiteFontId[]],
)

export const documentThemeSchema = z.object({
  colors: z.object({
    primary: hexSchema,
    secondary: hexSchema,
    accent: hexSchema,
    heading: hexSchema,
    text: hexSchema,
    muted: hexSchema,
    background: hexSchema,
    surface: hexSchema,
    border: hexSchema,
    highlight: hexSchema,
    inverse: hexSchema,
  }),
  fonts: z.object({ heading: fontIdSchema, body: fontIdSchema }),
  /** Body text size in px. */
  baseSize: z.number().min(12).max(22),
  /** Ratio between heading levels (h4 = base × ratio … h1 = base × ratio⁴). */
  headingScale: z.number().min(1.1).max(1.6),
  lineHeight: z.number().min(1.2).max(2),
  /** Vertical padding of a section, px. */
  sectionSpacing: z.number().min(0).max(160),
  /** Gap between the blocks of a section, px. */
  blockSpacing: z.number().min(0).max(64),
  /** Corners of cards, buttons, images and fields, px. */
  radius: z.number().min(0).max(32),
  /** Width of the content column in the web layout, px. */
  contentWidth: z.number().min(480).max(1200),
  /** Page margin of the paged layout and the PDF, mm (all sides). */
  pageMargin: z.number().min(5).max(40),
  logoUrl: z.string().max(2000).optional(),
})
export type DocumentTheme = z.infer<typeof documentThemeSchema>

const DEFAULT_PRIMARY = '#2453d6'

export function defaultDocumentTheme(): DocumentTheme {
  return {
    colors: {
      primary: DEFAULT_PRIMARY,
      secondary: mixHex(DEFAULT_PRIMARY, '#000000', 0.55),
      accent: '#0f9f6e',
      heading: '#111827',
      text: '#1f2937',
      muted: '#5f6b7a',
      background: '#eef0f4',
      surface: '#ffffff',
      border: '#e3e6ec',
      highlight: mixHex(DEFAULT_PRIMARY, '#ffffff', 0.93),
      inverse: '#ffffff',
    },
    fonts: { heading: 'geist', body: 'geist' },
    baseSize: 16,
    headingScale: 1.25,
    lineHeight: 1.65,
    sectionSpacing: 56,
    blockSpacing: 18,
    radius: 10,
    contentWidth: 760,
    pageMargin: 18,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expandHex(hex: string): string {
  if (hex.length !== 4) return hex.toLowerCase()
  const [, r, g, b] = hex
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
}

/** `from` blended towards `to` by `amount` (0 = from, 1 = to). */
export function mixHex(from: string, to: string, amount: number): string {
  const a = expandHex(from)
  const b = expandHex(to)
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
  const parts = [0, 1, 2].map((index) => {
    const value =
      channel(a, index) + (channel(b, index) - channel(a, index)) * amount
    const clamped = Math.round(Math.min(Math.max(value, 0), 255))
    return clamped.toString(16).padStart(2, '0')
  })
  return `#${parts.join('')}`
}

function pick<T>(value: unknown, schema: z.ZodType<T>, fallback: T): T {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

/**
 * The stored overrides completed with the defaults. Without an explicit
 * `secondary` or `highlight`, both derive from `primary` (darker for the
 * cover gradient, a light tint for highlighted sections), so a theme that
 * only sets the brand color stays coherent.
 */
export function parseDocumentTheme(input: unknown): DocumentTheme {
  const base = defaultDocumentTheme()
  if (!isRecord(input)) return base
  const shape = documentThemeSchema.shape
  const colorsIn = isRecord(input.colors) ? input.colors : {}
  const colors = { ...base.colors }
  for (const id of DOCUMENT_COLOR_IDS) {
    const value = colorsIn[id]
    if (hexSchema.safeParse(value).success) {
      colors[id] = expandHex(value as string)
    }
  }
  if (!hexSchema.safeParse(colorsIn.secondary).success) {
    colors.secondary = mixHex(colors.primary, '#000000', 0.55)
  }
  if (!hexSchema.safeParse(colorsIn.highlight).success) {
    colors.highlight = mixHex(colors.primary, '#ffffff', 0.93)
  }
  const fontsIn = isRecord(input.fonts) ? input.fonts : {}
  const logo =
    typeof input.logoUrl === 'string' && input.logoUrl.trim()
      ? input.logoUrl.trim().slice(0, 2000)
      : undefined
  return {
    colors,
    fonts: {
      heading: pick(fontsIn.heading, fontIdSchema, base.fonts.heading),
      body: pick(fontsIn.body, fontIdSchema, base.fonts.body),
    },
    baseSize: pick(input.baseSize, shape.baseSize, base.baseSize),
    headingScale: pick(input.headingScale, shape.headingScale, 1.25),
    lineHeight: pick(input.lineHeight, shape.lineHeight, base.lineHeight),
    sectionSpacing: pick(
      input.sectionSpacing,
      shape.sectionSpacing,
      base.sectionSpacing,
    ),
    blockSpacing: pick(
      input.blockSpacing,
      shape.blockSpacing,
      base.blockSpacing,
    ),
    radius: pick(input.radius, shape.radius, base.radius),
    contentWidth: pick(
      input.contentWidth,
      shape.contentWidth,
      base.contentWidth,
    ),
    pageMargin: pick(input.pageMargin, shape.pageMargin, base.pageMargin),
    ...(logo ? { logoUrl: logo } : {}),
  }
}

/** Colors offered by the color controls (`token:<id>`). */
export function documentColorTokens(theme: DocumentTheme): CanvasColorToken[] {
  return DOCUMENT_COLOR_IDS.map((id) => ({
    id,
    label: DOCUMENT_COLOR_LABELS[id],
    value: theme.colors[id],
  }))
}

/** CSS `font-family` of a theme font. */
export function documentFontStack(id: DocumentFontId): string {
  return fontStack(id)
}

/**
 * Closest theme font for a free-form family name (AI import, converted
 * proposals): monospace, serif and slab families map to their stacks,
 * anything else to Geist.
 */
export function documentFontIdFor(family: string | undefined): DocumentFontId {
  const value = (family ?? '').trim().toLowerCase()
  if (!value) return 'geist'
  const direct = SITE_FONTS.find(
    (font) => font.id === value || font.label.toLowerCase() === value,
  )
  if (direct) return direct.id
  if (/mono|code|courier|consolas/.test(value)) return 'mono'
  if (/slab|charter|rockwell|cambria/.test(value)) return 'slab'
  if (/serif|georgia|garamond|times|palatino|merriweather|lora/.test(value)) {
    return /sans/.test(value) ? 'humanist' : 'serif'
  }
  if (/system|arial|helvetica|roboto|segoe/.test(value)) return 'system'
  return 'geist'
}

/** Page box of the paged layout and the PDF in mm (orientation applied). */
export function documentPageBox(
  settings: Pick<DocumentSettingsDTO, 'pageSize' | 'orientation'>,
): { width: number; height: number } {
  const size = DOCUMENT_PAGE_SIZES[settings.pageSize] ?? DOCUMENT_PAGE_SIZES.A4
  return settings.orientation === 'landscape'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height }
}

const MM_TO_PX = 96 / 25.4

/** Canvas viewport widths of the editor: the sheet plus a gutter in the
 * paged layout, a comfortable reading width in the web layout. */
export function documentViewportWidths(
  settings: Pick<DocumentSettingsDTO, 'layout' | 'pageSize' | 'orientation'>,
): { base: number; mobile: number } {
  if (settings.layout !== 'paged') return { base: 1024, mobile: 390 }
  const page = documentPageBox(settings)
  return { base: Math.round(page.width * MM_TO_PX) + 96, mobile: 390 }
}

/** Google Fonts stylesheet of the families the PDF needs (the headless
 * browser has no app fonts): Geist for the default stack. */
export function documentFontsHref(theme: DocumentTheme): string | null {
  const usesGeist =
    theme.fonts.heading === 'geist' || theme.fonts.body === 'geist'
  return usesGeist
    ? 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap'
    : null
}
