import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import {
  SITE_COLOR_IDS,
  type SiteColorId,
  type SiteTextPreset,
  type SiteTheme,
  siteThemeSchema,
} from '@/src/lib/canvas-site/theme'
import { type DesignSpec, normalizeHex, paletteColor } from './design-spec'

/**
 * Site theme taken from a `DesignSpec`: the catalog kit closest to the
 * reference is the base; the reference's exact palette, fonts, heading
 * sizes, button shape, radii and content width replace its values. The
 * brand color the customer typed always wins over the reference's primary.
 * The result is checked against the theme schema; on any doubt the kit's
 * own theme is returned.
 */

const COLOR_ROLES = SITE_COLOR_IDS as readonly SiteColorId[]

function headingStyle(
  theme: SiteTheme,
  preset: SiteTextPreset,
  sizePx: number,
  spec: DesignSpec,
) {
  const style = theme.text[preset]
  style.size = {
    base: Math.round(sizePx),
    tablet: Math.round(sizePx * 0.82),
    mobile: Math.max(22, Math.round(sizePx * 0.62)),
  }
  style.weight = spec.typography.headingWeight
  style.lineHeight = spec.typography.headingLineHeight
  style.letterSpacing = spec.typography.headingLetterSpacingPx
  style.transform = spec.typography.headingTransform
}

export function designSpecToTheme(
  spec: DesignSpec,
  options: { primaryColor?: string | null } = {},
): SiteTheme {
  const base = SITE_KITS[spec.kit].theme
  const theme = structuredClone(base)

  for (const id of COLOR_ROLES) {
    const found = paletteColor(spec, id)
    if (found) theme.colors[id] = found
  }
  const brand = normalizeHex(options.primaryColor)
  if (brand) theme.colors.primary = brand

  theme.fonts = {
    heading: spec.typography.headingFont,
    body: spec.typography.bodyFont,
  }

  const type = spec.typography
  headingStyle(theme, 'h1', type.h1Px, spec)
  headingStyle(theme, 'h2', type.h2Px, spec)
  headingStyle(theme, 'h3', type.h3Px, spec)
  for (const preset of ['body', 'small', 'lead'] as const) {
    const style = theme.text[preset]
    const scale = preset === 'lead' ? 1.2 : preset === 'small' ? 0.875 : 1
    style.size = {
      base: Math.round(type.bodyPx * scale),
      tablet: style.size.tablet,
      mobile: style.size.mobile,
    }
    style.weight = type.bodyWeight
    style.lineHeight = type.bodyLineHeight
  }

  const buttons = spec.buttons
  theme.buttons.radius = buttons.radiusPx
  theme.buttons.paddingX = buttons.paddingXPx
  theme.buttons.paddingY = buttons.paddingYPx
  theme.buttons.fontSize = buttons.fontPx
  theme.buttons.fontWeight = buttons.fontWeight
  theme.buttons.transform = buttons.transform
  if (buttons.fill === 'outline' || buttons.fill === 'ghost') {
    theme.buttons.primary = {
      background: 'transparent',
      text: 'token:primary',
      border: 'token:primary',
      hoverBackground: 'token:primary',
      hoverText: 'token:inverse',
    }
  } else {
    if (buttons.backgroundHex) {
      theme.buttons.primary.background = buttons.backgroundHex
      theme.buttons.primary.border = buttons.backgroundHex
    } else if (brand) {
      theme.buttons.primary.background = 'token:primary'
      theme.buttons.primary.border = 'token:primary'
    }
    if (buttons.textHex) theme.buttons.primary.text = buttons.textHex
  }

  theme.radius = {
    sm: spec.radii.smPx,
    md: spec.radii.mdPx,
    lg: spec.radii.lgPx,
  }
  theme.contentWidth = spec.spacing.contentMaxWidthPx

  const checked = siteThemeSchema.safeParse(theme)
  return checked.success ? checked.data : base
}
