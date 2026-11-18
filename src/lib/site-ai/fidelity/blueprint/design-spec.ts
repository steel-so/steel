import { z } from 'zod'
import { SITE_FONTS, type SiteFontId } from '@/src/lib/canvas-site/theme'
import { SITE_AI_SECTIONS } from '@/src/lib/site-ai/sections'
import { strictJsonSchema } from './json-schema'

/**
 * `DesignSpec`: what the visual analysis reads from ONE reference (a page
 * capture or a picture the user sent) — the sections in order with their
 * layout, the exact palette, typography, buttons, cards, radii, shadows,
 * spacing and image style. It describes the design only: no copy, logos or
 * photos of the reference are carried over.
 *
 * Every field is required (strict structured outputs); a value the model
 * cannot tell is `null` (numbers/colors) or an empty string/array.
 */

export const FONT_IDS = SITE_FONTS.map((font) => font.id) as [
  SiteFontId,
  ...SiteFontId[],
]

export const DESIGN_COLOR_ROLES = [
  'background',
  'surface',
  'text',
  'muted',
  'primary',
  'secondary',
  'accent',
  'dark',
  'inverse',
  'border',
  'other',
] as const
export type DesignColorRole = (typeof DESIGN_COLOR_ROLES)[number]

export const DESIGN_RATIOS = [
  '1/1',
  '4/3',
  '3/2',
  '16/9',
  '3/4',
  '9/16',
  '21/9',
] as const
export type DesignRatio = (typeof DESIGN_RATIOS)[number]

const nullableNumber = z.number().nullable()
const nullableColor = z.string().nullable()
const align = z.enum(['left', 'center', 'right'])
const shadowLevel = z.enum(['none', 'soft', 'medium', 'strong'])

export const designSectionSchema = z.object({
  /** Free label: hero, logo strip, feature grid, pricing, footer… */
  type: z.string(),
  /** Layout in one or two sentences: columns, alignment, what sits where. */
  layout: z.string(),
  columns: z.number().int(),
  align,
  backgroundKind: z.enum(['none', 'color', 'gradient', 'image']),
  backgroundColor: nullableColor,
  /** Second color of a gradient. */
  backgroundColorTo: nullableColor,
  textColor: nullableColor,
  minHeightPx: nullableNumber,
  /** Vertical padding (top = bottom) in px at desktop width. */
  paddingYPx: nullableNumber,
  density: z.enum(['airy', 'regular', 'compact']),
  /** Elements top to bottom, short ("overline", "h1", "lead", "2 buttons",
   * "photo 4:3 on the right", "3 cards with icon"). */
  elements: z.array(z.string()),
  imageSide: z.enum(['none', 'left', 'right', 'top', 'bottom', 'background']),
  imageRatio: z.enum(DESIGN_RATIOS).nullable(),
  /** The closest ready section of the generator (fallback and data). */
  equivalent: z.enum(SITE_AI_SECTIONS),
  /** Where the section is in the capture (px, desktop viewport) or
   * `null` when the reference is a picture. */
  yStart: nullableNumber,
  yEnd: nullableNumber,
})
export type DesignSection = z.infer<typeof designSectionSchema>

export const designSpecSchema = z.object({
  /** Reference this spec describes (overwritten by the caller). */
  source: z.string(),
  /** Look and feel in one or two sentences. */
  summary: z.string(),
  /** Catalog style closest to the reference. */
  kit: z.enum(['agency', 'b2b', 'saas']),
  palette: z.array(
    z.object({
      hex: z.string(),
      role: z.enum(DESIGN_COLOR_ROLES),
      /** Where it is used ("hero background", "primary button"). */
      usage: z.string(),
    }),
  ),
  typography: z.object({
    headingFont: z.enum(FONT_IDS),
    bodyFont: z.enum(FONT_IDS),
    /** Font names as seen (informative). */
    observedHeadingFont: z.string(),
    observedBodyFont: z.string(),
    h1Px: z.number(),
    h2Px: z.number(),
    h3Px: z.number(),
    bodyPx: z.number(),
    headingWeight: z.number().int(),
    bodyWeight: z.number().int(),
    headingLineHeight: z.number(),
    bodyLineHeight: z.number(),
    headingLetterSpacingPx: z.number(),
    headingTransform: z.enum(['none', 'uppercase', 'capitalize']),
  }),
  buttons: z.object({
    radiusPx: z.number(),
    fill: z.enum(['solid', 'outline', 'ghost', 'link']),
    size: z.enum(['sm', 'md', 'lg']),
    paddingXPx: z.number(),
    paddingYPx: z.number(),
    fontPx: z.number(),
    fontWeight: z.number().int(),
    transform: z.enum(['none', 'uppercase', 'capitalize']),
    backgroundHex: nullableColor,
    textHex: nullableColor,
    /** Look of the secondary button, when there is one. */
    secondary: z.string(),
  }),
  cards: z.object({
    present: z.boolean(),
    radiusPx: z.number(),
    shadow: shadowLevel,
    borderPx: z.number(),
    borderHex: nullableColor,
    backgroundHex: nullableColor,
    paddingPx: z.number(),
  }),
  radii: z.object({ smPx: z.number(), mdPx: z.number(), lgPx: z.number() }),
  spacing: z.object({
    sectionPaddingYPx: z.number(),
    contentMaxWidthPx: z.number(),
    gridGapPx: z.number(),
  }),
  images: z.object({
    /** Style of the pictures ("rounded photos", "device mockups"). */
    style: z.string(),
    radiusPx: z.number(),
    dominantRatio: z.enum(DESIGN_RATIOS),
  }),
  sections: z.array(designSectionSchema),
})
export type DesignSpec = z.infer<typeof designSpecSchema>

export const DESIGN_SPEC_JSON_SCHEMA = strictJsonSchema(designSpecSchema)

export const MAX_DESIGN_SECTIONS = 18

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#rgb`/`#rrggbb` (any case) as lowercase `#rrggbb`; `null` otherwise. */
export function normalizeHex(value: string | null | undefined): string | null {
  const color = (value ?? '').trim()
  if (!HEX.test(color)) return null
  const lower = color.toLowerCase()
  return lower.length === 4
    ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
    : lower
}

/** Problems that make a spec unusable, as pt-BR lines for the repair turn. */
export function designSpecProblems(spec: DesignSpec): string[] {
  const problems: string[] = []
  const colors = spec.palette.filter((item) => normalizeHex(item.hex))
  if (colors.length < 3) {
    problems.push(
      'A paleta precisa de pelo menos 3 cores no formato #rrggbb, lidas da referência',
    )
  }
  if (spec.sections.length === 0) {
    problems.push('Liste as seções da referência, de cima para baixo')
  }
  return problems
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

/** The spec with colors in `#rrggbb`, numbers in sane ranges and at most
 * `MAX_DESIGN_SECTIONS` sections (invalid colors become `null`). */
export function normalizeDesignSpec(spec: DesignSpec): DesignSpec {
  const color = (value: string | null) => normalizeHex(value)
  return {
    ...spec,
    palette: spec.palette
      .map((item) => ({ ...item, hex: normalizeHex(item.hex) ?? '' }))
      .filter((item) => item.hex !== '')
      .slice(0, 16),
    typography: {
      ...spec.typography,
      h1Px: clamp(spec.typography.h1Px, 24, 140),
      h2Px: clamp(spec.typography.h2Px, 20, 100),
      h3Px: clamp(spec.typography.h3Px, 16, 60),
      bodyPx: clamp(spec.typography.bodyPx, 12, 24),
      headingWeight: clamp(spec.typography.headingWeight, 100, 900),
      bodyWeight: clamp(spec.typography.bodyWeight, 100, 900),
      headingLineHeight: clamp(spec.typography.headingLineHeight, 0.9, 2),
      bodyLineHeight: clamp(spec.typography.bodyLineHeight, 1, 2.2),
      headingLetterSpacingPx: clamp(
        spec.typography.headingLetterSpacingPx,
        -5,
        10,
      ),
    },
    buttons: {
      ...spec.buttons,
      radiusPx: clamp(spec.buttons.radiusPx, 0, 999),
      paddingXPx: clamp(spec.buttons.paddingXPx, 8, 80),
      paddingYPx: clamp(spec.buttons.paddingYPx, 4, 36),
      fontPx: clamp(spec.buttons.fontPx, 11, 24),
      fontWeight: clamp(spec.buttons.fontWeight, 100, 900),
      backgroundHex: color(spec.buttons.backgroundHex),
      textHex: color(spec.buttons.textHex),
    },
    cards: {
      ...spec.cards,
      radiusPx: clamp(spec.cards.radiusPx, 0, 80),
      borderPx: clamp(spec.cards.borderPx, 0, 8),
      paddingPx: clamp(spec.cards.paddingPx, 0, 80),
      borderHex: color(spec.cards.borderHex),
      backgroundHex: color(spec.cards.backgroundHex),
    },
    radii: {
      smPx: clamp(spec.radii.smPx, 0, 80),
      mdPx: clamp(spec.radii.mdPx, 0, 80),
      lgPx: clamp(spec.radii.lgPx, 0, 80),
    },
    spacing: {
      sectionPaddingYPx: clamp(spec.spacing.sectionPaddingYPx, 16, 240),
      contentMaxWidthPx: clamp(spec.spacing.contentMaxWidthPx, 640, 1600),
      gridGapPx: clamp(spec.spacing.gridGapPx, 4, 96),
    },
    images: {
      ...spec.images,
      radiusPx: clamp(spec.images.radiusPx, 0, 80),
    },
    sections: spec.sections.slice(0, MAX_DESIGN_SECTIONS).map((item) => ({
      ...item,
      columns: Math.round(clamp(item.columns, 1, 6)),
      backgroundColor: color(item.backgroundColor),
      backgroundColorTo: color(item.backgroundColorTo),
      textColor: color(item.textColor),
      minHeightPx:
        item.minHeightPx === null ? null : clamp(item.minHeightPx, 0, 1400),
      paddingYPx:
        item.paddingYPx === null ? null : clamp(item.paddingYPx, 0, 320),
    })),
  }
}

/** Color of a given role (first match), or `null`. */
export function paletteColor(
  spec: DesignSpec,
  role: DesignColorRole,
): string | null {
  return normalizeHex(spec.palette.find((item) => item.role === role)?.hex)
}
