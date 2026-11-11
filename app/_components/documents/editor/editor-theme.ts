import { SITE_FONTS } from '@/src/lib/canvas-site/theme'

/**
 * The few theme fields the document settings panel edits (brand color,
 * fonts, logo), read from the stored theme
 * overrides (`documents.theme`). The catalog completes everything else
 * with its defaults on render (`parseDocumentTheme` of the catalog), so the
 * panel only writes the keys it owns: `colors.primary`, `fonts.heading`,
 * `fonts.body` and `logoUrl`.
 */

export const DEFAULT_PRIMARY_COLOR = '#2453d6'

export const DOCUMENT_THEME_FONTS = SITE_FONTS.map((font) => ({
  value: font.id as string,
  label: font.label,
  stack: font.stack,
}))

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export interface EditableTheme {
  primary: string
  headingFont: string
  bodyFont: string
  logoUrl: string
}

export function readEditableTheme(
  theme: Record<string, unknown>,
): EditableTheme {
  const colors = record(theme.colors)
  const fonts = record(theme.fonts)
  const known = (value: unknown) =>
    typeof value === 'string' &&
    DOCUMENT_THEME_FONTS.some((font) => font.value === value)
  const primary =
    typeof colors.primary === 'string' && HEX.test(colors.primary)
      ? colors.primary
      : DEFAULT_PRIMARY_COLOR
  return {
    primary,
    headingFont: known(fonts.heading) ? (fonts.heading as string) : 'geist',
    bodyFont: known(fonts.body) ? (fonts.body as string) : 'geist',
    logoUrl: typeof theme.logoUrl === 'string' ? theme.logoUrl : '',
  }
}

/** The stored overrides with one editable field changed. */
export function writeEditableTheme(
  theme: Record<string, unknown>,
  patch: Partial<EditableTheme>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...theme }
  if (patch.primary !== undefined && HEX.test(patch.primary)) {
    next.colors = { ...record(theme.colors), primary: patch.primary }
  }
  if (patch.headingFont !== undefined || patch.bodyFont !== undefined) {
    next.fonts = {
      ...record(theme.fonts),
      ...(patch.headingFont !== undefined
        ? { heading: patch.headingFont }
        : {}),
      ...(patch.bodyFont !== undefined ? { body: patch.bodyFont } : {}),
    }
  }
  if (patch.logoUrl !== undefined) {
    const url = patch.logoUrl.trim()
    if (!url) {
      const { logoUrl: _removed, ...withoutLogo } = next
      return withoutLogo
    }
    next.logoUrl = url
  }
  return next
}

export const EDITOR_FONTS = DOCUMENT_THEME_FONTS.map((font) => ({
  label: font.label,
  value: font.stack,
}))
