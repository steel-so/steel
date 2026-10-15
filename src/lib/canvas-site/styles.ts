import type { CanvasBreakpoint } from '@/src/lib/canvas/types'
import {
  backgroundToCss,
  borderToCss,
  type CanvasRadius,
  type CanvasSize,
  type CanvasSpacing,
  type CanvasTypography,
  radiusToCss,
  resolveColor,
  shadowToCss,
  sizeToCss,
  spacingToCss,
  typographyToCss,
} from '@/src/lib/canvas/values'
import { SITE_TYPES } from './constants'
import { cssUrl } from './css-value'
import type {
  SiteButtonProps,
  SiteContainerProps,
  SiteDividerProps,
  SiteEmbedProps,
  SiteFormProps,
  SiteHeadingProps,
  SiteIconProps,
  SiteImageProps,
  SiteListProps,
  SiteMenuProps,
  SitePageProps,
  SiteSectionProps,
  SiteSocialProps,
  SiteSpacerProps,
  SiteTextProps,
  SiteVideoProps,
} from './schemas'
import { ELEMENT_STYLE_FNS } from './styles-elements'

/**
 * Style functions of the site catalog: props resolved for one breakpoint →
 * declarations per selector suffix (`''` is the element itself, `' img'`,
 * `':hover'`, `'::before'`…). The compiler (`css.ts`) calls them once per
 * breakpoint, keeps only what changes from the larger breakpoint and turns
 * the result into a hashed class. Colors stay `var(--canvas-<token>)`, so
 * the output does not depend on the theme.
 */

export type SiteDeclValue = string | number | undefined | null | false
export type SiteDecls = Record<string, SiteDeclValue>
export type SiteRuleSet = Record<string, SiteDecls>
export type SiteStyleFn = (
  props: never,
  breakpoint: CanvasBreakpoint,
) => SiteRuleSet

type Unresponsive<T> = T extends {
  base: infer B
  tablet?: unknown
  mobile?: unknown
}
  ? B
  : T

/** Props after `resolveProps`: every responsive value is a plain one. */
export type Resolved<P> = {
  [K in keyof P]: K extends 'visibility' ? P[K] : Unresponsive<P[K]>
}

const color = (value: string | undefined) => resolveColor(value)
const px = (value: number | undefined) =>
  value === undefined ? undefined : `${value}px`

const ALIGN_FLEX = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  stretch: 'stretch',
} as const

const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
} as const

const ALIGN_ITEMS = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
} as const

function margin(value: CanvasSpacing | undefined): SiteDecls {
  return { margin: spacingToCss(value) }
}

/** Margin plus auto sides that place a narrower block (`max-width`)
 * according to its text alignment. */
function blockPlacement(
  value: CanvasSpacing | undefined,
  align: string,
  narrowed: boolean,
): SiteDecls {
  const decls = margin(value)
  if (!narrowed || align === 'left' || align === 'justify') return decls
  return {
    ...decls,
    'margin-left': 'auto',
    'margin-right': align === 'center' ? 'auto' : undefined,
  }
}

function boxDecls(p: {
  border?: Parameters<typeof borderToCss>[0]
  radius?: CanvasRadius
  shadow?: Parameters<typeof shadowToCss>[0]
}): SiteDecls {
  return {
    border: borderToCss(p.border),
    'border-radius': radiusToCss(p.radius),
    'box-shadow': shadowToCss(p.shadow),
  }
}

function size(value: CanvasSize | undefined) {
  return sizeToCss(value)
}

function typography(value: CanvasTypography | undefined): SiteDecls {
  return typographyToCss(value) as SiteDecls
}

/** Background props with image URLs made stylesheet-safe. */
function background(value: Parameters<typeof backgroundToCss>[0]): SiteDecls {
  const css: SiteDecls = { ...backgroundToCss(value) }
  if (value?.kind === 'image' && value.url) {
    css.backgroundImage = cssUrl(value.url)
  }
  return css
}

const page = (p: Resolved<SitePageProps>): SiteRuleSet => ({
  '': { ...background(p.background), 'min-height': '100%' },
})

const section = (p: Resolved<SiteSectionProps>): SiteRuleSet => {
  const overlay = p.overlay?.color ? p.overlay : null
  const layered = !!(p.video?.src || overlay)
  const rules: SiteRuleSet = {
    '': {
      position: 'relative',
      isolation: layered ? 'isolate' : undefined,
      overflow: layered || p.radius ? 'hidden' : undefined,
      display: 'flex',
      'flex-direction': 'column',
      'justify-content': ALIGN_ITEMS[p.verticalAlign],
      ...background(p.background),
      color: color(p.textColor),
      padding: spacingToCss(p.padding),
      'min-height': size(p.minHeight),
      ...boxDecls(p),
      ...margin(p.margin),
    },
    ' > .s-inner': {
      width: '100%',
      'max-width':
        p.width === 'full'
          ? 'none'
          : p.maxWidth !== undefined
            ? `${p.maxWidth}px`
            : 'var(--s-content)',
      gap: px(p.gap),
      'align-items': ALIGN_ITEMS[p.contentAlign],
    },
  }
  if (overlay) {
    rules['::before'] = {
      content: '""',
      position: 'absolute',
      inset: 0,
      'background-color': color(overlay.color),
      opacity: (overlay.opacity ?? 50) / 100,
      'z-index': -1,
      'pointer-events': 'none',
    }
  }
  return rules
}

const container = (p: Resolved<SiteContainerProps>): SiteRuleSet => {
  const grid = p.layout === 'grid'
  const free = p.positioning === 'free'
  const rules: SiteRuleSet = {
    '': {
      position: free ? 'relative' : undefined,
      display: grid ? 'grid' : 'flex',
      'flex-direction': grid ? undefined : p.direction,
      'flex-wrap': grid ? undefined : p.wrap ? 'wrap' : 'nowrap',
      'grid-template-columns': grid
        ? p.columnsTemplate || `repeat(${p.columns}, minmax(0, 1fr))`
        : undefined,
      gap: px(p.gap),
      'row-gap': px(p.rowGap),
      'align-items': ALIGN_ITEMS[p.alignItems],
      'justify-content': JUSTIFY[p.justify],
      flex: p.grow ? '1 1 0' : undefined,
      'min-width': 0,
      width: size(p.width),
      'max-width': size(p.maxWidth),
      'min-height': size(p.minHeight) ?? (free ? '320px' : undefined),
      padding: spacingToCss(p.padding),
      ...background(p.background),
      color: color(p.textColor),
      'text-align': p.textAlign,
      ...boxDecls(p),
      ...margin(p.margin),
    },
  }
  if (free) {
    // "Posição livre": each child sets --s-x/--s-y/--s-w/--s-z (effects).
    rules[' > *'] = {
      position: 'absolute',
      left: 'var(--s-x,0px)',
      top: 'var(--s-y,0px)',
      width: 'var(--s-w,auto)',
      'z-index': 'var(--s-z,auto)',
    }
  }
  return rules
}

function textBlock(
  p: Resolved<SiteHeadingProps> | Resolved<SiteTextProps>,
  align: string,
): SiteRuleSet {
  return {
    '': {
      'text-align': align,
      color: color(p.color),
      ...typography(p.typography),
      'max-width': size(p.maxWidth),
      ...blockPlacement(p.margin, align, !!p.maxWidth),
    },
  }
}

const heading = (p: Resolved<SiteHeadingProps>) => textBlock(p, p.align)
const text = (p: Resolved<SiteTextProps>) => textBlock(p, p.align)

const button = (p: Resolved<SiteButtonProps>): SiteRuleSet => {
  const custom = !!(p.background || p.textColor || p.borderColor)
  const look: SiteDecls = {
    width: p.align === 'stretch' ? '100%' : undefined,
    'background-color': color(p.background),
    color: color(p.textColor),
    'border-color': color(p.borderColor),
    'border-radius': px(p.radius),
  }
  return {
    '': {
      display: 'flex',
      'justify-content':
        p.align === 'stretch' ? 'stretch' : ALIGN_FLEX[p.align],
      ...margin(p.margin),
    },
    ' > a': look,
    ' > a:hover': custom ? { filter: 'brightness(0.92)' } : {},
    // A button without a link that runs an interaction (popup, scroll…).
    ' > button': p.interaction && p.interaction.action !== 'none' ? look : {},
  }
}

const image = (p: Resolved<SiteImageProps>): SiteRuleSet => ({
  '': {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': ALIGN_FLEX[p.align],
    // A fixed-width image keeps its size inside a flex row.
    flex: p.width.unit === 'px' ? 'none' : undefined,
    ...margin(p.margin),
  },
  ' img': {
    width: '100%',
    height: 'auto',
    'aspect-ratio': p.aspectRatio === 'auto' ? undefined : p.aspectRatio,
    'object-fit': p.fit,
    ...boxDecls(p),
  },
  ' .s-media': {
    width: size(p.width),
    'max-width': size(p.maxWidth) ?? '100%',
  },
  ' figcaption': { 'text-align': p.align },
})

const icon = (p: Resolved<SiteIconProps>): SiteRuleSet => {
  const boxed = p.shape !== 'none'
  const box = boxed ? p.size + p.padding * 2 : p.size
  return {
    '': {
      display: 'flex',
      'justify-content': ALIGN_FLEX[p.align],
      ...margin(p.margin),
    },
    ' .s-icon-box': {
      width: px(box),
      height: px(box),
      color: color(p.color),
      'background-color': boxed ? color(p.background) : undefined,
      'border-radius': boxed
        ? p.shape === 'circle'
          ? '50%'
          : 'var(--s-radius-md)'
        : undefined,
    },
    ' svg': { width: px(p.size), height: px(p.size) },
  }
}

const video = (p: Resolved<SiteVideoProps>): SiteRuleSet => ({
  '': {
    width: size(p.width) ?? '100%',
    'max-width': '100%',
    ...margin(p.margin),
  },
  ' .s-video-frame': {
    'aspect-ratio': p.aspectRatio,
    'border-radius': radiusToCss(p.radius),
  },
})

const divider = (p: Resolved<SiteDividerProps>): SiteRuleSet => ({
  '': {
    border: 'none',
    'border-top': `${p.thickness}px ${p.style} ${color(p.color)}`,
    width: size(p.width),
    'max-width': '100%',
    ...blockPlacement(p.margin, p.align, true),
  },
})

const spacer = (p: Resolved<SiteSpacerProps>): SiteRuleSet => ({
  '': { height: px(p.height), flex: 'none' },
})

const list = (p: Resolved<SiteListProps>): SiteRuleSet => ({
  '': {
    display: 'grid',
    'grid-template-columns': `repeat(${p.columns}, minmax(0, 1fr))`,
    gap: px(p.gap),
    color: color(p.color),
    ...margin(p.margin),
  },
  ' .s-marker': { color: color(p.markerColor) },
  ' > li::before': { color: color(p.markerColor) },
})

const form = (p: Resolved<SiteFormProps>): SiteRuleSet => ({
  '': {
    'grid-template-columns':
      p.columns === '2' ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
    ...margin(p.margin),
  },
  ' .s-input': { 'background-color': color(p.fieldBackground) },
  ' .s-form-actions': {
    'justify-content':
      p.buttonAlign === 'stretch' ? 'stretch' : ALIGN_FLEX[p.buttonAlign],
  },
  ' .s-form-actions > .s-btn': {
    width: p.buttonAlign === 'stretch' ? '100%' : undefined,
  },
})

const menu = (p: Resolved<SiteMenuProps>): SiteRuleSet => {
  const vertical = p.orientation === 'vertical'
  return {
    '': { ...margin(p.margin) },
    ' .s-menu-inline': {
      'flex-direction': vertical ? 'column' : 'row',
      'justify-content': vertical ? undefined : JUSTIFY[p.justify],
      'align-items': vertical ? JUSTIFY[p.justify] : 'center',
      gap: px(p.gap),
    },
    ' .s-menu-link': { color: color(p.color) },
    ' .s-menu-link:hover': { color: color(p.hoverColor) },
  }
}

const social = (p: Resolved<SiteSocialProps>): SiteRuleSet => {
  const boxed = p.shape !== 'none'
  const iconSize = boxed ? Math.round(p.size * 0.55) : p.size
  return {
    '': {
      'justify-content': ALIGN_FLEX[p.align],
      gap: px(p.gap),
      ...margin(p.margin),
    },
    ' a': {
      width: px(p.size),
      height: px(p.size),
      color: color(p.color),
      'background-color': boxed ? color(p.background) : undefined,
      'border-radius': boxed
        ? p.shape === 'circle'
          ? '50%'
          : 'var(--s-radius-md)'
        : undefined,
    },
    ' svg': { width: px(iconSize), height: px(iconSize) },
  }
}

const embed = (p: Resolved<SiteEmbedProps>): SiteRuleSet => ({
  '': { ...margin(p.margin) },
  ' iframe': { height: px(p.height) },
})

/** Style function per component type. Types without one get no class. */
export const SITE_STYLE_FNS: Record<string, SiteStyleFn> = {
  [SITE_TYPES.page]: page as SiteStyleFn,
  [SITE_TYPES.section]: section as SiteStyleFn,
  [SITE_TYPES.container]: container as SiteStyleFn,
  [SITE_TYPES.heading]: heading as SiteStyleFn,
  [SITE_TYPES.text]: text as SiteStyleFn,
  [SITE_TYPES.button]: button as SiteStyleFn,
  [SITE_TYPES.image]: image as SiteStyleFn,
  [SITE_TYPES.icon]: icon as SiteStyleFn,
  [SITE_TYPES.video]: video as SiteStyleFn,
  [SITE_TYPES.divider]: divider as SiteStyleFn,
  [SITE_TYPES.spacer]: spacer as SiteStyleFn,
  [SITE_TYPES.list]: list as SiteStyleFn,
  [SITE_TYPES.form]: form as SiteStyleFn,
  [SITE_TYPES.menu]: menu as SiteStyleFn,
  [SITE_TYPES.social]: social as SiteStyleFn,
  [SITE_TYPES.embed]: embed as SiteStyleFn,
  ...ELEMENT_STYLE_FNS,
}
