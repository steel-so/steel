import { z } from 'zod'

/**
 * Value shapes edited by the composite inspector controls (color, spacing,
 * typography, border, radius, shadow, background, image, link, size,
 * visibility). Catalogs use these schemas inside their `propsSchema` and the
 * CSS helpers in their renderers, so every catalog stores the same shapes and
 * the shell controls work everywhere.
 */

// ─── color ────────────────────────────────────────────────────────────────

/** `token:<id>` (theme token), `#RGB`/`#RRGGBB`/`#RRGGBBAA` or `transparent`. */
export const canvasColorSchema = z
  .string()
  .regex(
    /^(token:[a-z][a-z0-9-]*|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent)$/,
  )
export type CanvasColor = z.infer<typeof canvasColorSchema>

export interface CanvasColorToken {
  /** Used as `token:<id>`. */
  id: string
  label: string
  /** Literal color the token resolves to. */
  value: string
}

export const TOKEN_PREFIX = 'token:'

export function isTokenColor(color: string): boolean {
  return color.startsWith(TOKEN_PREFIX)
}

/** CSS color: a token resolves through `tokens` (else `var(--canvas-<id>)`);
 * empty/undefined gives `undefined` so the style key is dropped. */
export function resolveColor(
  color: string | undefined,
  tokens?: readonly CanvasColorToken[],
): string | undefined {
  if (!color) return undefined
  if (!isTokenColor(color)) return color
  const id = color.slice(TOKEN_PREFIX.length)
  return (
    tokens?.find((token) => token.id === id)?.value ?? `var(--canvas-${id})`
  )
}

// ─── box model ────────────────────────────────────────────────────────────

const px = z.number().min(0).max(2000)

export const canvasSpacingSchema = z.object({
  top: px,
  right: px,
  bottom: px,
  left: px,
})
export type CanvasSpacing = z.infer<typeof canvasSpacingSchema>

export function spacing(all: number): CanvasSpacing
export function spacing(vertical: number, horizontal: number): CanvasSpacing
export function spacing(
  vertical: number,
  horizontal = vertical,
): CanvasSpacing {
  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  }
}

export function spacingToCss(value: CanvasSpacing | undefined) {
  if (!value) return undefined
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

export const canvasRadiusSchema = z.object({
  topLeft: px,
  topRight: px,
  bottomRight: px,
  bottomLeft: px,
})
export type CanvasRadius = z.infer<typeof canvasRadiusSchema>

export function radiusToCss(value: CanvasRadius | undefined) {
  if (!value) return undefined
  return `${value.topLeft}px ${value.topRight}px ${value.bottomRight}px ${value.bottomLeft}px`
}

export const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'] as const

export const canvasBorderSchema = z.object({
  width: z.number().min(0).max(50),
  style: z.enum(BORDER_STYLES),
  color: canvasColorSchema,
})
export type CanvasBorder = z.infer<typeof canvasBorderSchema>

export function borderToCss(
  value: CanvasBorder | undefined,
  tokens?: readonly CanvasColorToken[],
) {
  if (!value || value.style === 'none' || value.width === 0) return undefined
  return `${value.width}px ${value.style} ${resolveColor(value.color, tokens)}`
}

export const canvasShadowSchema = z
  .object({
    x: z.number().min(-200).max(200),
    y: z.number().min(-200).max(200),
    blur: z.number().min(0).max(400),
    spread: z.number().min(-200).max(200),
    color: canvasColorSchema,
    inset: z.boolean().optional(),
  })
  .nullable()
export type CanvasShadow = z.infer<typeof canvasShadowSchema>

export function shadowToCss(
  value: CanvasShadow | undefined,
  tokens?: readonly CanvasColorToken[],
) {
  if (!value) return undefined
  const color = resolveColor(value.color, tokens)
  return `${value.inset ? 'inset ' : ''}${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${color}`
}

// ─── typography ───────────────────────────────────────────────────────────

export const TEXT_TRANSFORMS = [
  'none',
  'uppercase',
  'lowercase',
  'capitalize',
] as const

export const canvasTypographySchema = z.object({
  fontFamily: z.string().max(200).optional(),
  fontSize: z.number().min(6).max(400).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  /** Unitless multiplier (1.5). */
  lineHeight: z.number().min(0.5).max(5).optional(),
  /** In px. */
  letterSpacing: z.number().min(-20).max(100).optional(),
  textTransform: z.enum(TEXT_TRANSFORMS).optional(),
  italic: z.boolean().optional(),
})
export type CanvasTypography = z.infer<typeof canvasTypographySchema>

export function typographyToCss(value: CanvasTypography | undefined) {
  if (!value) return {}
  const css: Record<string, string | number> = {}
  if (value.fontFamily) css.fontFamily = value.fontFamily
  if (value.fontSize !== undefined) css.fontSize = `${value.fontSize}px`
  if (value.fontWeight !== undefined) css.fontWeight = value.fontWeight
  if (value.lineHeight !== undefined) css.lineHeight = value.lineHeight
  if (value.letterSpacing !== undefined) {
    css.letterSpacing = `${value.letterSpacing}px`
  }
  if (value.textTransform) css.textTransform = value.textTransform
  if (value.italic) css.fontStyle = 'italic'
  return css
}

// ─── background ───────────────────────────────────────────────────────────

export const canvasBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('color'), color: canvasColorSchema }),
  z.object({
    kind: z.literal('gradient'),
    angle: z.number().min(0).max(360),
    from: canvasColorSchema,
    to: canvasColorSchema,
  }),
  z.object({
    kind: z.literal('image'),
    url: z.string().max(2000),
    /** Fallback color under the image (e-mail clients that block images). */
    color: canvasColorSchema.optional(),
    position: z.enum(['center', 'top', 'bottom', 'left', 'right']),
    size: z.enum(['cover', 'contain', 'auto']),
    repeat: z.boolean(),
  }),
])
export type CanvasBackground = z.infer<typeof canvasBackgroundSchema>

/** `background*` CSS properties for a background value. */
export function backgroundToCss(
  value: CanvasBackground | undefined,
  tokens?: readonly CanvasColorToken[],
): Record<string, string> {
  if (!value) return {}
  switch (value.kind) {
    case 'none':
      return {}
    case 'color':
      return { backgroundColor: resolveColor(value.color, tokens) as string }
    case 'gradient':
      return {
        backgroundImage: `linear-gradient(${value.angle}deg, ${resolveColor(value.from, tokens)}, ${resolveColor(value.to, tokens)})`,
      }
    case 'image': {
      const css: Record<string, string> = {
        backgroundPosition: value.position,
        backgroundSize: value.size,
        backgroundRepeat: value.repeat ? 'repeat' : 'no-repeat',
      }
      if (value.url)
        css.backgroundImage = `url("${value.url.replace(/"/g, '%22')}")`
      if (value.color) {
        css.backgroundColor = resolveColor(value.color, tokens) as string
      }
      return css
    }
  }
}

// ─── media, links, sizes ──────────────────────────────────────────────────

export const canvasImageSchema = z.object({
  src: z.string().max(2000),
  alt: z.string().max(500),
})
export type CanvasImage = z.infer<typeof canvasImageSchema>

export const LINK_TARGETS = [
  'url',
  'page',
  'anchor',
  'email',
  'phone',
  'file',
] as const
export type CanvasLinkTarget = (typeof LINK_TARGETS)[number]

export const canvasLinkSchema = z.object({
  type: z.enum(LINK_TARGETS),
  value: z.string().max(2000),
  newTab: z.boolean().optional(),
})
export type CanvasLink = z.infer<typeof canvasLinkSchema>

/** `href` for a link value (`mailto:`, `tel:`, `#anchor`); `undefined`
 * when empty. Page ids resolve through `pageHref` (sites). */
export function linkHref(
  link: CanvasLink | undefined,
  pageHref?: (pageId: string) => string,
): string | undefined {
  const value = link?.value.trim()
  if (!link || !value) return undefined
  switch (link.type) {
    case 'email':
      return value.startsWith('mailto:') ? value : `mailto:${value}`
    case 'phone':
      return value.startsWith('tel:')
        ? value
        : `tel:${value.replace(/[^\d+]/g, '')}`
    case 'anchor':
      return value.startsWith('#') ? value : `#${value}`
    case 'page':
      return pageHref ? pageHref(value) : value
    default:
      return value
  }
}

export const SIZE_UNITS = ['px', '%', 'auto', 'fill', 'vh'] as const
export type CanvasSizeUnit = (typeof SIZE_UNITS)[number]

export const canvasSizeSchema = z.object({
  value: z.number().min(0).max(10000).nullable(),
  unit: z.enum(SIZE_UNITS),
})
export type CanvasSize = z.infer<typeof canvasSizeSchema>

/** CSS length; `fill` is `100%`, `auto`/empty values are `auto`. */
export function sizeToCss(value: CanvasSize | undefined): string | undefined {
  if (!value) return undefined
  if (value.unit === 'fill') return '100%'
  if (value.unit === 'auto' || value.value === null) return 'auto'
  return `${value.value}${value.unit}`
}

/** Shown (`true`) per breakpoint. */
export const canvasVisibilitySchema = z.object({
  base: z.boolean(),
  tablet: z.boolean(),
  mobile: z.boolean(),
})
export type CanvasVisibility = z.infer<typeof canvasVisibilitySchema>

export const VISIBLE_EVERYWHERE: CanvasVisibility = {
  base: true,
  tablet: true,
  mobile: true,
}

/** Wraps a value schema so it also accepts `{ base, tablet?, mobile? }`. */
export function responsiveSchema<T extends z.ZodType>(schema: T) {
  return z.union([
    schema,
    z.object({
      base: schema,
      tablet: schema.optional(),
      mobile: schema.optional(),
    }),
  ])
}
