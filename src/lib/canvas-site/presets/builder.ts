import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
  CanvasProps,
} from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import {
  type CanvasBackground,
  type CanvasLink,
  spacing,
} from '@/src/lib/canvas/values'
import { siteCatalog } from '../catalog'
import { SITE_CATALOG_ID, SITE_CATALOG_VERSION, SITE_TYPES } from '../constants'
import type { SiteIconName, SocialNetwork } from '../icons'
import type {
  SiteButtonProps,
  SiteContainerProps,
  SiteHeadingProps,
  SiteImageProps,
  SiteSectionProps,
  SiteTextProps,
} from '../schemas'

/**
 * A tiny tree builder for presets and templates: specs list only the props
 * that differ from the component's `defaultProps`, children nest, and
 * `toFragment` assigns sequential ids (the editor clones fragments with
 * fresh cuid2 ids on insert).
 */

export interface NodeSpec {
  type: string
  props: CanvasProps
  children?: NodeSpec[]
  name?: string
}

type Props<T> = Partial<T> & CanvasProps

export function spec(
  type: string,
  props: CanvasProps = {},
  children?: NodeSpec[],
): NodeSpec {
  return { type, props, children }
}

/** Renames the node in the layers tree. */
export function named(name: string, node: NodeSpec): NodeSpec {
  return { ...node, name }
}

export function toFragment(root: NodeSpec): CanvasFragment {
  const nodes: Record<string, CanvasNode> = {}
  let next = 0
  const visit = (node: NodeSpec): string => {
    const id = `n${next++}`
    const definition = siteCatalog.components[node.type]
    const built: CanvasNode = {
      id,
      type: node.type,
      props: { ...definition.defaultProps(), ...node.props },
    }
    if (definition.accepts !== false) built.children = []
    if (node.name) built.meta = { name: node.name }
    nodes[id] = built
    for (const child of node.children ?? []) {
      built.children?.push(visit(child))
    }
    return id
  }
  const rootId = visit(root)
  return { rootId, nodes }
}

/** A page document whose root holds `sections` (in order). */
export function toDocument(
  sections: NodeSpec[],
  pageProps: CanvasProps = {},
): CanvasDocument {
  const fragment = toFragment(spec(SITE_TYPES.page, pageProps, sections))
  const nodes = { ...fragment.nodes }
  const root = nodes[fragment.rootId]
  delete nodes[fragment.rootId]
  nodes[ROOT_ID] = { ...root, id: ROOT_ID }
  return {
    catalog: SITE_CATALOG_ID,
    version: SITE_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes,
  }
}

// ─── element shorthands ───────────────────────────────────────────────────

export const url = (value: string): CanvasLink => ({ type: 'url', value })
export const anchor = (value: string): CanvasLink => ({ type: 'anchor', value })
export const solid = (color: string): CanvasBackground => ({
  kind: 'color',
  color,
})

export function section(
  props: Props<SiteSectionProps>,
  children: NodeSpec[],
): NodeSpec {
  return spec(SITE_TYPES.section, props, children)
}

export function box(
  props: Props<SiteContainerProps>,
  children: NodeSpec[],
): NodeSpec {
  return spec(SITE_TYPES.container, props, children)
}

/** Grid of equal columns that stacks to one column on mobile (and to
 * `tablet` columns on tablet). */
export function grid(
  columns: number,
  children: NodeSpec[],
  props: Props<SiteContainerProps> = {},
  tablet = Math.min(columns, 2),
  mobile = 1,
): NodeSpec {
  return box(
    {
      layout: 'grid',
      columns: { base: columns, tablet, mobile },
      gap: { base: 32, mobile: 24 },
      ...props,
    },
    children,
  )
}

/** Horizontal group (buttons, logo + menu) that wraps when narrow. */
export function row(
  children: NodeSpec[],
  props: Props<SiteContainerProps> = {},
): NodeSpec {
  return box(
    { direction: 'row', wrap: true, alignItems: 'center', gap: 16, ...props },
    children,
  )
}

export function heading(
  level: SiteHeadingProps['level'],
  text: string,
  props: Props<SiteHeadingProps> = {},
): NodeSpec {
  return spec(SITE_TYPES.heading, { level, text, ...props })
}

export function text(
  content: string,
  props: Props<SiteTextProps> = {},
): NodeSpec {
  const html = content.startsWith('<') ? content : `<p>${content}</p>`
  return spec(SITE_TYPES.text, { html, ...props })
}

export function overline(
  content: string,
  props: Props<SiteTextProps> = {},
): NodeSpec {
  return text(content, { preset: 'overline', color: 'token:accent', ...props })
}

export function button(
  label: string,
  link: CanvasLink,
  props: Props<SiteButtonProps> = {},
): NodeSpec {
  return spec(SITE_TYPES.button, { label, link, ...props })
}

/** Intrinsic size of the kit images the presets use (no layout shift). */
const ASSET_SIZES: Record<string, [number, number]> = {
  'saas-subscription/hero-mockup.png': [1696, 1124],
  'b2b/hero-portrait.png': [815, 1272],
  'agency/hero-portrait.png': [926, 926],
  'b2b/content01-photo.png': [616, 421],
  'agency/about-photo-main.png': [445, 565],
  'agency/testimonial-avatar-1.png': [328, 328],
  'b2b/testimonial-avatar-2.png': [108, 108],
  'b2b/testimonial-avatar-3.png': [108, 108],
  'job-site/logo-askimat.png': [308, 60],
  'job-site/logo-coworks.png': [292, 48],
  'job-site/logo-dorfus.png': [294, 56],
  'job-site/logo-greener.png': [296, 60],
  'job-site/logo-makeless.png': [280, 48],
  'job-site/logo-saastoday.png': [310, 62],
  'agency/work-1.png': [500, 540],
  'agency/work-2.png': [500, 346],
  'agency/work-3.png': [500, 342],
  'agency/work-4.png': [500, 540],
  'ecommerce/product-armen-living-chair.png': [260, 375],
  'ecommerce/product-kingso-round-table.png': [230, 357],
  'ecommerce/product-knight-chair.png': [284, 398],
  'ecommerce/product-rivet-accent-chair.png': [326, 343],
}

export const PRESET_ASSET_BASE = '/landing-page-templates/'

export function image(
  src: string,
  alt: string,
  props: Props<SiteImageProps> = {},
): NodeSpec {
  const size = ASSET_SIZES[src.replace(PRESET_ASSET_BASE, '')]
  return spec(SITE_TYPES.image, {
    image: { src, alt },
    ...(size ? { dimensions: { width: size[0], height: size[1] } } : {}),
    ...props,
  })
}

export function icon(name: SiteIconName, props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.icon, { name, ...props })
}

export function list(items: string[], props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.list, {
    items: items.map((value) => ({ text: value })),
    ...props,
  })
}

export function divider(props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.divider, props)
}

export function spacer(base: number, mobile = Math.round(base * 0.6)) {
  return spec(SITE_TYPES.spacer, { height: { base, mobile } })
}

export function menu(props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.menu, props)
}

export function social(
  networks: SocialNetwork[],
  props: CanvasProps = {},
): NodeSpec {
  return spec(SITE_TYPES.social, {
    items: networks.map((network) => ({
      network,
      url: `https://${network === 'x' ? 'x' : network}.com/`,
    })),
    ...props,
  })
}

export function form(props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.form, props)
}

export function video(url: string, props: CanvasProps = {}): NodeSpec {
  return spec(SITE_TYPES.video, { url, ...props })
}

export { spacing }
