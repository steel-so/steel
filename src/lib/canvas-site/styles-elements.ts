import {
  backgroundToCss,
  borderToCss,
  type CanvasRadius,
  type CanvasShadow,
  radiusToCss,
  resolveColor,
  shadowToCss,
  sizeToCss,
  spacingToCss,
} from '@/src/lib/canvas/values'
import { SITE_TYPES } from './constants'
import { cssUrl } from './css-value'
import type {
  SiteAccordionItemProps,
  SiteAccordionProps,
  SiteBeforeAfterProps,
  SiteCarouselProps,
  SiteCountdownProps,
  SiteGalleryProps,
  SiteLogosProps,
  SiteMapProps,
  SitePopupProps,
  SitePricingProps,
  SiteSlideProps,
  SiteStatsProps,
  SiteTabProps,
  SiteTabsProps,
  SiteTestimonialsProps,
  SiteWhatsappProps,
} from './schemas'
import type { Resolved, SiteDecls, SiteRuleSet, SiteStyleFn } from './styles'

/**
 * Style functions of the S2 elements (same contract as `styles.ts`: props
 * resolved for one breakpoint → declarations per selector suffix). The
 * structural part of each element lives in `static-css-elements.ts`,
 * included only on pages that use it.
 */

const color = (value: string | undefined) => resolveColor(value)
const px = (value: number | undefined) =>
  value === undefined ? undefined : `${value}px`
const margin = (value: Parameters<typeof spacingToCss>[0]): SiteDecls => ({
  margin: spacingToCss(value),
})
const columns = (count: number) => `repeat(${count}, minmax(0, 1fr))`

const FLEX_ALIGN = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  start: 'flex-start',
  end: 'flex-end',
  stretch: 'stretch',
} as const

function card(p: {
  radius?: CanvasRadius
  border?: Parameters<typeof borderToCss>[0]
  shadow?: CanvasShadow
}): SiteDecls {
  return {
    'border-radius': radiusToCss(p.radius),
    border: borderToCss(p.border),
    'box-shadow': shadowToCss(p.shadow),
  }
}

/** Background props with image URLs made stylesheet-safe. */
function background(value: Parameters<typeof backgroundToCss>[0]): SiteDecls {
  const css: SiteDecls = { ...backgroundToCss(value) }
  if (value?.kind === 'image' && value.url) {
    css.backgroundImage = cssUrl(value.url)
  }
  return css
}

/** Width of one slide of `perView` with `gap` between them. */
function slideBasis(perView: number, gap: number): string {
  if (perView <= 1) return '100%'
  return `calc((100% - ${(perView - 1) * gap}px) / ${perView})`
}

const gallery = (p: Resolved<SiteGalleryProps>): SiteRuleSet => {
  const masonry = p.layout === 'masonry'
  return {
    '': margin(p.margin),
    ' > .s-gallery-list': masonry
      ? { columns: p.columns, 'column-gap': px(p.gap) }
      : {
          display: 'grid',
          'grid-template-columns': columns(p.columns),
          gap: px(p.gap),
        },
    ' .s-gallery-item': masonry ? { 'margin-bottom': px(p.gap) } : {},
    ' img': {
      'aspect-ratio':
        masonry || p.aspectRatio === 'auto' ? undefined : p.aspectRatio,
      'object-fit': p.fit,
      'border-radius': radiusToCss(p.radius),
    },
  }
}

const carousel = (p: Resolved<SiteCarouselProps>): SiteRuleSet => ({
  '': margin(p.margin),
  ' > .s-carousel-track': { gap: px(p.gap) },
  ' > .s-carousel-track > *': { flex: `0 0 ${slideBasis(p.perView, p.gap)}` },
  ' > .s-carousel-controls .s-carousel-btn': { color: color(p.controlColor) },
  ' > .s-carousel-controls .s-carousel-dot[aria-current=true]::before': {
    'background-color': color(p.controlColor),
  },
})

const slide = (p: Resolved<SiteSlideProps>): SiteRuleSet => ({
  '': {
    ...background(p.background),
    color: color(p.textColor),
    padding: spacingToCss(p.padding),
    gap: px(p.gap),
    'align-items': FLEX_ALIGN[p.alignItems],
    'justify-content': FLEX_ALIGN[p.verticalAlign],
    'min-height': sizeToCss(p.minHeight),
    'border-radius': radiusToCss(p.radius),
  },
})

const tabs = (p: Resolved<SiteTabsProps>): SiteRuleSet => {
  const vertical = p.orientation === 'vertical'
  return {
    '': {
      '--s-tab-active': color(p.activeColor),
      '--s-tab-color': color(p.tabColor),
      gap: px(p.gap),
      'grid-template-columns': vertical
        ? 'minmax(160px, 260px) 1fr'
        : undefined,
      ...margin(p.margin),
    },
    ' > .s-tablist': {
      'justify-content': p.align === 'center' ? 'center' : undefined,
    },
    ' > .s-tablist > .s-tab-btn': {
      flex: p.align === 'stretch' && !vertical ? '1 1 0' : undefined,
    },
  }
}

const tab = (p: Resolved<SiteTabProps>): SiteRuleSet => ({
  '': { padding: spacingToCss(p.padding), gap: px(p.gap) },
})

const accordion = (p: Resolved<SiteAccordionProps>): SiteRuleSet => ({
  '': {
    gap: px(p.gap),
    '--s-acc-bg': color(p.itemBackground),
    '--s-acc-border': color(p.borderColor),
    ...margin(p.margin),
  },
  ' > .s-acc-item': { 'border-radius': radiusToCss(p.radius) },
})

const accordionItem = (p: Resolved<SiteAccordionItemProps>): SiteRuleSet => ({
  '': margin(p.margin),
  ' > .s-acc-body': { gap: px(p.gap) },
})

const popup = (p: Resolved<SitePopupProps>): SiteRuleSet => ({
  '': {
    width: `min(${p.width}px, calc(100vw - 32px))`,
    ...background(p.background),
    color: color(p.textColor),
    padding: spacingToCss(p.padding),
    'border-radius': radiusToCss(p.radius),
    'box-shadow': shadowToCss(p.shadow),
  },
  ' > .s-popup-body': { gap: px(p.gap) },
  '::backdrop': {
    background: `color-mix(in srgb, ${color(p.overlayColor)} ${p.overlayOpacity}%, transparent)`,
  },
})

const countdown = (p: Resolved<SiteCountdownProps>): SiteRuleSet => ({
  '': {
    'justify-content': FLEX_ALIGN[p.align],
    '--s-cd-size': px(p.size),
    ...margin(p.margin),
  },
  ' .s-cd-num': { color: color(p.numberColor) },
  ' .s-cd-label': { color: color(p.labelColor) },
  ' .s-cd-unit': { 'background-color': color(p.boxBackground) },
})

const stats = (p: Resolved<SiteStatsProps>): SiteRuleSet => ({
  '': {
    'grid-template-columns': columns(p.columns),
    gap: px(p.gap),
    'text-align': p.align,
    ...margin(p.margin),
  },
  ' > .s-stat': { 'align-items': FLEX_ALIGN[p.align] },
  ' .s-stat-num': {
    'font-size': px(p.numberSize),
    color: color(p.numberColor),
  },
  ' .s-stat-label': { color: color(p.labelColor) },
})

const testimonials = (p: Resolved<SiteTestimonialsProps>): SiteRuleSet => {
  const slider = p.layout === 'slider'
  return {
    '': { 'text-align': p.align, ...margin(p.margin) },
    ' > .s-tm-list': slider
      ? { gap: px(p.gap) }
      : {
          display: 'grid',
          'grid-template-columns': columns(p.columns),
          gap: px(p.gap),
        },
    ' > .s-tm-list > *': slider
      ? { flex: `0 0 ${slideBasis(p.columns, p.gap)}` }
      : {},
    ' .s-tm-card': {
      'background-color': color(p.cardBackground),
      'align-items': p.align === 'center' ? 'center' : 'flex-start',
      ...card(p),
    },
    ' .s-tm-author': {
      'justify-content': p.align === 'center' ? 'center' : undefined,
    },
    ' .s-stars': {
      color: color(p.starColor),
      'justify-content': p.align === 'center' ? 'center' : undefined,
    },
  }
}

const pricing = (p: Resolved<SitePricingProps>): SiteRuleSet => ({
  '': { 'text-align': p.align, ...margin(p.margin) },
  ' > .s-pricing-list': {
    'grid-template-columns': columns(p.columns),
    gap: px(p.gap),
  },
  ' .s-plan': { 'background-color': color(p.cardBackground), ...card(p) },
  ' .s-plan-hl': {
    'background-color': color(p.highlightBackground),
    color: color(p.highlightText),
  },
  ' .s-plan-features svg': { color: color(p.checkColor) },
  ' .s-plan-features': {
    'align-items': p.align === 'center' ? 'center' : undefined,
  },
  ' .s-plan-badge': {
    'align-self': p.align === 'center' ? 'center' : undefined,
  },
  ' .s-plan-price': {
    'justify-content': p.align === 'center' ? 'center' : undefined,
  },
})

const logos = (p: Resolved<SiteLogosProps>): SiteRuleSet => {
  const marquee = p.mode === 'marquee'
  return {
    '': margin(p.margin),
    ' .s-logos-list': marquee
      ? { gap: px(p.gap), 'padding-right': px(p.gap) }
      : {
          'grid-template-columns': columns(p.columns),
          gap: px(p.gap),
          'justify-items': FLEX_ALIGN[p.align],
        },
    ' .s-marquee-track': marquee ? { 'animation-duration': `${p.speed}s` } : {},
    ' img': {
      height: px(p.height),
      filter: p.grayscale ? 'grayscale(1)' : undefined,
      opacity: p.grayscale ? 0.7 : undefined,
    },
    ' li:hover img': p.grayscale ? { filter: 'none', opacity: 1 } : {},
  }
}

const map = (p: Resolved<SiteMapProps>): SiteRuleSet => ({
  '': margin(p.margin),
  ' > .s-map-frame': {
    height: px(p.height),
    'border-radius': radiusToCss(p.radius),
  },
})

const whatsapp = (p: Resolved<SiteWhatsappProps>): SiteRuleSet => ({
  '': {
    'justify-content': p.mode === 'inline' ? FLEX_ALIGN[p.align] : undefined,
    ...margin(p.mode === 'inline' ? p.margin : undefined),
  },
  ' .s-wa-btn': {
    'background-color': color(p.color),
    color: color(p.textColor),
  },
})

const beforeAfter = (p: Resolved<SiteBeforeAfterProps>): SiteRuleSet => ({
  '': {
    '--s-pos': `${p.start}%`,
    // The photos are layered absolutely: the box needs its own proportion.
    'aspect-ratio': p.aspectRatio === 'auto' ? '4/3' : p.aspectRatio,
    'border-radius': radiusToCss(p.radius),
    ...margin(p.margin),
  },
  ' .s-ba-handle': { 'background-color': color(p.handleColor) },
})

export const ELEMENT_STYLE_FNS: Record<string, SiteStyleFn> = {
  [SITE_TYPES.gallery]: gallery as SiteStyleFn,
  [SITE_TYPES.carousel]: carousel as SiteStyleFn,
  [SITE_TYPES.slide]: slide as SiteStyleFn,
  [SITE_TYPES.tabs]: tabs as SiteStyleFn,
  [SITE_TYPES.tab]: tab as SiteStyleFn,
  [SITE_TYPES.accordion]: accordion as SiteStyleFn,
  [SITE_TYPES.accordionItem]: accordionItem as SiteStyleFn,
  [SITE_TYPES.popup]: popup as SiteStyleFn,
  [SITE_TYPES.countdown]: countdown as SiteStyleFn,
  [SITE_TYPES.stats]: stats as SiteStyleFn,
  [SITE_TYPES.testimonials]: testimonials as SiteStyleFn,
  [SITE_TYPES.pricing]: pricing as SiteStyleFn,
  [SITE_TYPES.logos]: logos as SiteStyleFn,
  [SITE_TYPES.map]: map as SiteStyleFn,
  [SITE_TYPES.whatsapp]: whatsapp as SiteStyleFn,
  [SITE_TYPES.beforeAfter]: beforeAfter as SiteStyleFn,
}
