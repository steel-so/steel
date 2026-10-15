import type { CanvasRenderProps } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasProps } from '@/src/lib/canvas/types'
import {
  type CanvasColorToken,
  isTokenColor,
  TOKEN_PREFIX,
} from '@/src/lib/canvas/values'
import {
  DEFAULT_PRIMARY_COLOR,
  type EmailBrand,
  readableTextOn,
  tint,
} from '@/src/lib/crm-email-builder/brand'

/**
 * Theme of the e-mail catalog: color tokens derived from the workspace
 * brand, the font list (e-mail-safe stacks + Google Fonts with a safe
 * fallback) and the render context every component reads (brand, CRM
 * product data, mobile CSS). Tokens follow the react-email "Barebone"
 * template (MIT), the same scale as the v1 builder.
 */

export const EMAIL_PALETTE = {
  canvas: '#F3F4F6',
  card: '#FFFFFF',
  fg: '#14171E',
  fg2: '#43454B',
  fg3: '#7B7D81',
  stroke: '#E4E4E7',
} as const

/** Color tokens offered by the inspector (`token:<id>`), resolved from the
 * brand at render time so a brand change recolors every template. */
export function emailColorTokens(brand: EmailBrand): CanvasColorToken[] {
  const primary = brand.primaryColor || DEFAULT_PRIMARY_COLOR
  return [
    { id: 'primary', label: 'Cor da marca', value: primary },
    {
      id: 'on-primary',
      label: 'Texto sobre a marca',
      value: readableTextOn(primary),
    },
    { id: 'primary-soft', label: 'Marca suave', value: tint(primary, 0.06) },
    { id: 'text', label: 'Texto', value: EMAIL_PALETTE.fg },
    { id: 'text-muted', label: 'Texto secundário', value: EMAIL_PALETTE.fg2 },
    { id: 'text-subtle', label: 'Texto discreto', value: EMAIL_PALETTE.fg3 },
    { id: 'border', label: 'Borda', value: EMAIL_PALETTE.stroke },
    { id: 'canvas', label: 'Fundo externo', value: EMAIL_PALETTE.canvas },
    { id: 'surface', label: 'Fundo do conteúdo', value: EMAIL_PALETTE.card },
  ]
}

// ─── fonts ────────────────────────────────────────────────────────────────

export type EmailFont = {
  id: string
  label: string
  /** CSS `font-family` with e-mail-safe fallbacks. */
  stack: string
  /** Google Fonts family (`Open+Sans`) loaded by clients that support web
   * fonts; everyone else uses the fallback of `stack`. */
  google?: string
}

const SANS = 'Helvetica, Arial, sans-serif'
const SERIF = "Georgia, 'Times New Roman', serif"

export const EMAIL_FONTS: readonly EmailFont[] = [
  {
    id: 'system',
    label: 'Sistema',
    stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ${SANS}`,
  },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'helvetica', label: 'Helvetica', stack: SANS },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  {
    id: 'trebuchet',
    label: 'Trebuchet MS',
    stack: "'Trebuchet MS', Helvetica, sans-serif",
  },
  { id: 'georgia', label: 'Georgia', stack: SERIF },
  {
    id: 'times',
    label: 'Times New Roman',
    stack: "'Times New Roman', Times, serif",
  },
  {
    id: 'courier',
    label: 'Courier New',
    stack: "'Courier New', Courier, monospace",
  },
  { id: 'inter', label: 'Inter', stack: `Inter, ${SANS}`, google: 'Inter' },
  { id: 'roboto', label: 'Roboto', stack: `Roboto, ${SANS}`, google: 'Roboto' },
  {
    id: 'open-sans',
    label: 'Open Sans',
    stack: `'Open Sans', ${SANS}`,
    google: 'Open+Sans',
  },
  { id: 'lato', label: 'Lato', stack: `Lato, ${SANS}`, google: 'Lato' },
  {
    id: 'montserrat',
    label: 'Montserrat',
    stack: `Montserrat, ${SANS}`,
    google: 'Montserrat',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    stack: `Poppins, ${SANS}`,
    google: 'Poppins',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: `Merriweather, ${SERIF}`,
    google: 'Merriweather',
  },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    stack: `'Playfair Display', ${SERIF}`,
    google: 'Playfair+Display',
  },
]

export const EMAIL_FONT_IDS = EMAIL_FONTS.map((font) => font.id) as [
  string,
  ...string[],
]

export function emailFont(id: string): EmailFont {
  return EMAIL_FONTS.find((font) => font.id === id) ?? EMAIL_FONTS[0]
}

/** Stylesheet URL of a Google font (`null` for e-mail-safe stacks). */
export function googleFontHref(font: EmailFont): string | null {
  if (!font.google) return null
  return `https://fonts.googleapis.com/css2?family=${font.google}:ital,wght@0,400;0,600;0,700;1,400&display=swap`
}

/** Fonts for the shell typography control (CSS values with fallbacks). */
export const EMAIL_TYPOGRAPHY_FONTS = EMAIL_FONTS.map((font) => ({
  label: font.label,
  value: font.stack,
}))

// ─── render context ───────────────────────────────────────────────────────

/** CRM product data a product block shows (resolved by the server). */
export type EmailProductData = {
  name: string
  description: string
  /** Formatted price ("R$ 1.290,00"). */
  price: string
}

export type EmailRenderContext = {
  brand: EmailBrand
  tokens: CanvasColorToken[]
  /** Products by id, for `email.product` blocks. */
  products: Record<string, EmailProductData>
  /** E-mail subject (`<title>`); empty in the editor. */
  subject: string
  /** Mobile media-query rules collected from the document (final output). */
  mobileCss: string
  /** The document being rendered: blocks read the body defaults and a
   * column its siblings' widths. The editor passes a reader over the
   * store (`() => store.getState().doc`). */
  doc?: () => CanvasDocument
}

/**
 * Props of an e-mail component view: the engine's render props plus the
 * render context, injected by the catalog (`createEmailCatalog`). A plain
 * value, not React context — the server renders e-mails inside route
 * handlers, where React context is not available.
 */
export type EmailViewProps<P extends CanvasProps = CanvasProps> =
  CanvasRenderProps<P> & { ctx: EmailRenderContext }

export const DEFAULT_EMAIL_BRAND: EmailBrand = {
  companyName: 'Sua empresa',
  logoUrl: '',
  primaryColor: DEFAULT_PRIMARY_COLOR,
  address: '',
  website: '',
}

export function createEmailRenderContext(
  partial: Partial<Omit<EmailRenderContext, 'tokens'>> = {},
): EmailRenderContext {
  const brand = partial.brand ?? DEFAULT_EMAIL_BRAND
  return {
    brand,
    tokens: emailColorTokens(brand),
    products: partial.products ?? {},
    subject: partial.subject ?? '',
    mobileCss: partial.mobileCss ?? '',
    doc: partial.doc,
  }
}

/**
 * CSS color for e-mail output: tokens resolve through the brand; unknown
 * tokens are dropped (no CSS variables in e-mail clients).
 */
export function emailColor(
  value: string | undefined,
  tokens: readonly CanvasColorToken[],
): string | undefined {
  if (!value) return undefined
  if (!isTokenColor(value)) return value
  const id = value.slice(TOKEN_PREFIX.length)
  return tokens.find((token) => token.id === id)?.value
}
