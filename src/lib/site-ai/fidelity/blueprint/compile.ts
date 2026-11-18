import type { CanvasProps } from '@/src/lib/canvas/types'
import {
  type CanvasBackground,
  type CanvasLink,
  type CanvasShadow,
  type CanvasSize,
  spacing,
} from '@/src/lib/canvas/values'
import {
  box,
  button,
  divider,
  form,
  heading,
  icon,
  image,
  list,
  type NodeSpec,
  named,
  section,
  spacer,
  text,
} from '@/src/lib/canvas-site/presets/builder'
import { SITE_AI_PLACEHOLDERS } from '@/src/lib/site-ai/images'
import { escapeHtml } from '@/src/lib/site-ai/slots'
import { normalizeHex } from './design-spec'
import {
  type BlueprintBox,
  type BlueprintButton,
  type BlueprintHeading,
  type BlueprintImage,
  type BlueprintNode,
  type BlueprintText,
  isBox,
  type SectionBlueprint,
} from './section-blueprint'

/**
 * Blueprint → `NodeSpec` (the builder's tree, which `toDocument` turns
 * into a canvas document). Every number is clamped to what the catalog
 * accepts, every color is checked, and keys with no value are left out
 * (the builder merges the component's defaults under what is given), so
 * the output validates by construction.
 */

export interface BlueprintCompileContext {
  /** Where buttons point (the contact page or section). */
  contactLink: CanvasLink
  /** `id` of the section (target of `#anchor` links), e.g. the contact
   * section's `contato`. */
  sectionAnchor?: string
}

type Align = 'left' | 'center' | 'right'

// ─── small helpers ────────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

const round = (value: number) => Math.round(value)

/** Drops `undefined` values: the builder spreads props over the defaults. */
function compact<T extends object = CanvasProps>(
  props: Record<string, unknown>,
): T {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as T
}

const px = (value: number): CanvasSize => ({ value: round(value), unit: 'px' })
const percent = (value: number): CanvasSize => ({ value, unit: '%' })

function resp<T>(base: T, tablet?: T, mobile?: T): T | { base: T } {
  if (tablet === undefined && mobile === undefined) return base
  return {
    base,
    ...(tablet === undefined ? {} : { tablet }),
    ...(mobile === undefined ? {} : { mobile }),
  } as { base: T }
}

/** `#rrggbb` color or `undefined` (token colors pass through). */
function color(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (/^token:[a-z][a-z0-9-]*$/.test(value) || value === 'transparent') {
    return value
  }
  return normalizeHex(value) ?? undefined
}

const SHADOWS: Record<'sm' | 'md' | 'lg', NonNullable<CanvasShadow>> = {
  sm: { x: 0, y: 2, blur: 8, spread: 0, color: '#0000001a' },
  md: { x: 0, y: 8, blur: 24, spread: -4, color: '#00000026' },
  lg: { x: 0, y: 24, blur: 56, spread: -12, color: '#00000040' },
}

function shadowOf(level: 'none' | 'sm' | 'md' | 'lg' | null | undefined) {
  return level && level !== 'none' ? SHADOWS[level] : undefined
}

function radiusOf(value: number | null | undefined) {
  if (value === null || value === undefined) return undefined
  const r = clamp(value, 0, 999)
  return { topLeft: r, topRight: r, bottomRight: r, bottomLeft: r }
}

function backgroundOf(
  bg: string | null,
  gradient: { from: string; to: string; angle: number } | null,
): CanvasBackground | undefined {
  if (gradient) {
    const from = color(gradient.from)
    const to = color(gradient.to)
    if (from && to) {
      return {
        kind: 'gradient',
        angle: clamp(gradient.angle, 0, 360),
        from,
        to,
      }
    }
  }
  const solid = color(bg)
  return solid ? { kind: 'color', color: solid } : undefined
}

function clip(value: string, max: number): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

function sizeMobile(base: number, given: number | null): number | undefined {
  if (given !== null) return clamp(given, 6, 400)
  return base >= 30 ? clamp(round(base * 0.6), 24, base) : undefined
}

function sizeTablet(base: number): number | undefined {
  return base >= 30 ? round(base * 0.82) : undefined
}

// ─── typography ───────────────────────────────────────────────────────────

interface TypeLike {
  sizePx: number | null
  sizeMobilePx: number | null
  weight: number | null
  lineHeight: number | null
  letterSpacingPx: number | null
  transform: 'none' | 'uppercase' | 'capitalize' | null
}

/** `typography` prop (responsive) of a heading or text, or `undefined`
 * when the model set nothing (the theme preset then rules). */
function typography(node: TypeLike): unknown {
  const base = compact<Record<string, unknown>>({
    fontSize:
      node.sizePx === null ? undefined : clamp(round(node.sizePx), 6, 400),
    fontWeight:
      node.weight === null ? undefined : round(clamp(node.weight, 100, 900)),
    lineHeight:
      node.lineHeight === null ? undefined : clamp(node.lineHeight, 0.8, 3),
    letterSpacing:
      node.letterSpacingPx === null
        ? undefined
        : clamp(node.letterSpacingPx, -10, 20),
    textTransform:
      node.transform === null || node.transform === 'none'
        ? undefined
        : node.transform,
  })
  if (Object.keys(base).length === 0) return undefined
  if (node.sizePx === null) return base
  const tablet = sizeTablet(node.sizePx)
  const mobile = sizeMobile(node.sizePx, node.sizeMobilePx)
  if (tablet === undefined && mobile === undefined) return base
  return {
    base,
    ...(tablet === undefined ? {} : { tablet: { fontSize: tablet } }),
    ...(mobile === undefined ? {} : { mobile: { fontSize: mobile } }),
  }
}

// ─── image placeholders ───────────────────────────────────────────────────

const RATIO_VALUE: Record<BlueprintImage['ratio'], number> = {
  '1/1': 1,
  '4/3': 4 / 3,
  '3/2': 3 / 2,
  '16/9': 16 / 9,
  '3/4': 3 / 4,
  '9/16': 9 / 16,
  '21/9': 21 / 9,
}

/** The catalog's placeholder photo whose proportion is closest. */
export function closestPlaceholder(ratio: BlueprintImage['ratio']) {
  const target = RATIO_VALUE[ratio]
  let best = SITE_AI_PLACEHOLDERS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of SITE_AI_PLACEHOLDERS) {
    const distance = Math.abs(Math.log(item.width / item.height / target))
    if (distance < bestDistance) {
      best = item
      bestDistance = distance
    }
  }
  return best
}

// ─── leaves ───────────────────────────────────────────────────────────────

function compileHeading(node: BlueprintHeading, inherited: Align): NodeSpec {
  return heading(
    node.level,
    clip(node.text, 500),
    compact({
      align: node.align ?? inherited,
      color: color(node.color),
      typography: typography(node),
      maxWidth:
        node.maxWidth === null ? undefined : px(clamp(node.maxWidth, 80, 2000)),
    }),
  )
}

function paragraphs(value: string): string {
  const parts = value
    .split(/\n{2,}|\n/)
    .map((part) => clip(part, 600))
    .filter(Boolean)
  return (parts.length > 0 ? parts : [''])
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('')
}

function compileText(node: BlueprintText, inherited: Align): NodeSpec {
  return text(
    paragraphs(node.text).slice(0, 20_000),
    compact({
      preset: node.preset,
      align: node.align ?? inherited,
      color: color(node.color),
      typography: typography(node),
      maxWidth:
        node.maxWidth === null ? undefined : px(clamp(node.maxWidth, 80, 2000)),
    }),
  )
}

function compileButton(
  node: BlueprintButton,
  ctx: BlueprintCompileContext,
  inherited: Align,
): NodeSpec {
  return button(
    clip(node.label, 120),
    ctx.contactLink,
    compact({
      variant: node.variant,
      size: node.size,
      align: node.align ?? inherited,
      background: color(node.bg),
      textColor: color(node.textColor),
      borderColor: color(node.borderColor),
      radius: node.radius === null ? undefined : clamp(node.radius, 0, 999),
      icon: node.icon ?? undefined,
    }),
  )
}

function compileImage(node: BlueprintImage, inherited: Align): NodeSpec {
  const radius = node.circle ? 999 : node.radius
  const widthPx =
    node.widthPx === null ? null : clamp(round(node.widthPx), 24, 2400)
  const align = node.align ?? inherited
  if (node.source === 'blank') {
    const height = round((widthPx ?? 480) / RATIO_VALUE[node.ratio])
    return box(
      compact({
        background: {
          kind: 'color',
          color: color(node.bg) ?? 'token:border',
        },
        radius: radiusOf(radius),
        shadow: shadowOf(node.shadow),
        width:
          widthPx === null
            ? undefined
            : resp(px(widthPx), undefined, percent(100)),
        maxWidth: percent(100),
        minHeight: resp(
          px(clamp(height, 40, 1400)),
          undefined,
          px(clamp(height, 40, 320)),
        ),
        alignItems: align === 'center' ? 'center' : 'start',
      }),
      [],
    )
  }
  const placeholder = closestPlaceholder(node.ratio)
  return image(
    placeholder.src,
    clip(node.alt, 500),
    compact({
      width:
        widthPx === null
          ? percent(100)
          : resp(px(widthPx), undefined, percent(100)),
      maxWidth: percent(100),
      aspectRatio: node.ratio,
      fit: node.fit,
      align,
      radius: radiusOf(radius),
      shadow: shadowOf(node.shadow),
      dimensions: { width: placeholder.width, height: placeholder.height },
    }),
  )
}

function compileLeaf(
  node: Exclude<BlueprintNode, BlueprintBox>,
  ctx: BlueprintCompileContext,
  inherited: Align,
): NodeSpec {
  switch (node.type) {
    case 'heading':
      return compileHeading(node, inherited)
    case 'text':
      return compileText(node, inherited)
    case 'button':
      return compileButton(node, ctx, inherited)
    case 'image':
      return compileImage(node, inherited)
    case 'icon': {
      const shaped = node.shape !== 'none'
      return icon(
        node.name,
        compact({
          size: clamp(node.sizePx ?? 28, 8, 256),
          color: color(node.color),
          shape: node.shape,
          background: shaped ? color(node.bg) : undefined,
          padding: shaped ? 12 : 0,
          align: node.align ?? inherited,
        }),
      )
    }
    case 'list':
      return list(
        node.items
          .map((item) => clip(item, 500))
          .filter(Boolean)
          .slice(0, 50),
        compact({
          marker: node.marker,
          markerColor: color(node.markerColor),
          preset: node.preset,
          color: color(node.color),
          gap: node.gap === null ? undefined : clamp(node.gap, 0, 400),
          columns:
            node.columns === null
              ? undefined
              : round(clamp(node.columns, 1, 4)),
        }),
      )
    case 'divider':
      return divider(
        compact({
          color: color(node.color),
          thickness:
            node.thickness === null ? undefined : clamp(node.thickness, 1, 20),
        }),
      )
    case 'spacer': {
      const height = clamp(round(node.heightPx), 0, 800)
      return spacer(
        height,
        node.heightMobilePx === null
          ? Math.round(height * 0.6)
          : clamp(round(node.heightMobilePx), 0, 800),
      )
    }
    case 'form':
      return form(
        compact({
          submitLabel: clip(node.submitLabel, 80) || 'Enviar',
          columns: node.columns === 2 ? { base: '2', mobile: '1' } : '1',
          buttonVariant: node.buttonVariant,
          fieldBackground: color(node.fieldBg),
        }),
      )
  }
}

// ─── boxes ────────────────────────────────────────────────────────────────

const TRACKS = /^[a-z0-9 .%(),-]*$/i

function gridProps(node: BlueprintBox): CanvasProps {
  const columns = Math.round(clamp(node.columns ?? 2, 1, 12))
  const tablet = Math.round(
    clamp(node.columnsTablet ?? Math.min(columns, 2), 1, 12),
  )
  const mobile = Math.round(clamp(node.columnsMobile ?? 1, 1, 12))
  const template = node.columnsTemplate?.trim()
  if (template && template.length <= 200 && TRACKS.test(template)) {
    const tracks = template.split(/\s+/).length
    return {
      layout: 'grid',
      columns: { base: columns, tablet, mobile },
      columnsTemplate: {
        base: template,
        tablet:
          tracks <= tablet ? template : `repeat(${tablet}, minmax(0, 1fr))`,
        mobile: `repeat(${mobile}, minmax(0, 1fr))`,
      },
    }
  }
  return { layout: 'grid', columns: { base: columns, tablet, mobile } }
}

function padding(
  padY: number | null,
  padX: number | null,
  padYMobile: number | null,
  padXMobile: number | null,
) {
  if (padY === null && padX === null) return undefined
  const y = clamp(round(padY ?? 0), 0, 600)
  const x = clamp(round(padX ?? 0), 0, 600)
  const my =
    padYMobile === null ? round(y * 0.7) : clamp(round(padYMobile), 0, 600)
  const mx =
    padXMobile === null ? Math.min(x, 20) : clamp(round(padXMobile), 0, 600)
  const base = spacing(y, x)
  if (my === y && mx === x) return base
  return { base, mobile: spacing(my, mx) }
}

function gapOf(gap: number | null, gapMobile: number | null) {
  if (gap === null) return undefined
  const base = clamp(round(gap), 0, 400)
  const mobile =
    gapMobile === null
      ? base >= 24
        ? round(base * 0.75)
        : undefined
      : clamp(round(gapMobile), 0, 400)
  return mobile === undefined || mobile === base ? base : { base, mobile }
}

function compileBox(
  node: BlueprintBox,
  ctx: BlueprintCompileContext,
  inherited: Align,
): NodeSpec {
  const isCard = node.card
  const own: Align = node.textAlign ?? inherited
  const layout: CanvasProps =
    node.layout === 'grid'
      ? gridProps(node)
      : {
          layout: 'flex',
          direction: node.layout,
          ...(node.layout === 'row' ? { wrap: node.wrap ?? true } : {}),
        }
  const background =
    backgroundOf(node.bg, node.gradient) ??
    (isCard ? ({ kind: 'color', color: 'token:surface' } as const) : undefined)
  const radius = radiusOf(node.radius ?? (isCard ? 12 : null))
  const border =
    node.borderWidth && node.borderWidth > 0
      ? {
          width: clamp(node.borderWidth, 0, 50),
          style: 'solid' as const,
          color: color(node.borderColor) ?? 'token:border',
        }
      : undefined
  const props: Parameters<typeof box>[0] = compact({
    ...layout,
    alignItems: node.align ?? undefined,
    justify: node.justify ?? undefined,
    gap: gapOf(node.gap, node.gapMobile),
    padding: padding(
      node.padY ?? (isCard ? 32 : null),
      node.padX ?? (isCard ? 28 : null),
      node.padYMobile,
      node.padXMobile,
    ),
    background,
    textColor: color(node.color),
    textAlign: node.textAlign ?? undefined,
    maxWidth:
      node.maxWidth === null ? undefined : px(clamp(node.maxWidth, 80, 2400)),
    minHeight:
      node.minHeight === null ? undefined : px(clamp(node.minHeight, 0, 1600)),
    radius,
    border,
    shadow: shadowOf(node.shadow),
  })
  return box(
    props,
    node.children.map((child) => compileNode(child, ctx, own)),
  )
}

function compileNode(
  node: BlueprintNode,
  ctx: BlueprintCompileContext,
  inherited: Align,
): NodeSpec {
  return isBox(node)
    ? compileBox(node, ctx, inherited)
    : compileLeaf(node, ctx, inherited)
}

// ─── section ──────────────────────────────────────────────────────────────

/** Compiles a blueprint into one `site.section` spec (named in the layers
 * tree after `blueprint.name`). */
export function blueprintToNodeSpec(
  blueprint: SectionBlueprint,
  ctx: BlueprintCompileContext,
): NodeSpec {
  const props: Parameters<typeof section>[0] = compact({
    tag: 'section',
    background: backgroundOf(blueprint.bg, blueprint.gradient) ?? {
      kind: 'none',
    },
    textColor: color(blueprint.color),
    padding:
      blueprint.padY === null
        ? undefined
        : padding(
            blueprint.padY,
            blueprint.padX ?? 24,
            blueprint.padYMobile,
            blueprint.padXMobile,
          ),
    minHeight:
      blueprint.minHeight === null
        ? undefined
        : px(clamp(blueprint.minHeight, 0, 1600)),
    width: blueprint.fullWidth ? 'full' : 'boxed',
    maxWidth:
      blueprint.maxWidth === null
        ? undefined
        : round(clamp(blueprint.maxWidth, 240, 2400)),
    gap: gapOf(blueprint.gap, blueprint.gapMobile),
    contentAlign: blueprint.contentAlign,
    verticalAlign: blueprint.verticalAlign,
    anchor: ctx.sectionAnchor,
  })
  return named(
    clip(blueprint.name, 60) || 'Seção',
    section(
      props,
      blueprint.children.map((child) => compileNode(child, ctx, 'left')),
    ),
  )
}
