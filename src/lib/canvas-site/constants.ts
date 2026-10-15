import type { CanvasBreakpoint } from '@/src/lib/canvas/types'

/**
 * Identity of the site catalog of Steel Canvas (ADR 0026, phase S1). A site
 * page document is `{ catalog: 'site', version: 1 }`; bump the version only
 * with a converter for the stored documents.
 */
export const SITE_CATALOG_ID = 'site'
export const SITE_CATALOG_VERSION = 1

export const SITE_BREAKPOINTS = [
  'base',
  'tablet',
  'mobile',
] as const satisfies readonly CanvasBreakpoint[]

/** Media query of each breakpoint below `base` (desktop first: a tablet
 * rule also applies on mobile unless mobile overrides it). The editor
 * canvas uses the same widths, so the iframe matches these queries. */
export const SITE_MEDIA: Record<Exclude<CanvasBreakpoint, 'base'>, string> = {
  tablet: '(max-width: 1023.98px)',
  mobile: '(max-width: 767.98px)',
}

/** Exact range of each breakpoint (visibility utilities). */
export const SITE_RANGE: Record<CanvasBreakpoint, string> = {
  base: '(min-width: 1024px)',
  tablet: '(min-width: 768px) and (max-width: 1023.98px)',
  mobile: '(max-width: 767.98px)',
}

/** Canvas viewport per breakpoint in the editor (inside each range). */
export const SITE_VIEWPORT_WIDTHS = { base: 1280, tablet: 768, mobile: 375 }

export const SITE_TYPES = {
  page: 'site.page',
  section: 'site.section',
  container: 'site.container',
  columns: 'site.columns',
  heading: 'site.heading',
  text: 'site.text',
  button: 'site.button',
  image: 'site.image',
  icon: 'site.icon',
  video: 'site.video',
  divider: 'site.divider',
  spacer: 'site.spacer',
  list: 'site.list',
  form: 'site.form',
  menu: 'site.menu',
  social: 'site.social',
  embed: 'site.embed',
} as const

/** Content elements (leaves): what sections and containers accept besides
 * containers. */
export const SITE_ELEMENT_TYPES: string[] = [
  SITE_TYPES.heading,
  SITE_TYPES.text,
  SITE_TYPES.button,
  SITE_TYPES.image,
  SITE_TYPES.icon,
  SITE_TYPES.video,
  SITE_TYPES.divider,
  SITE_TYPES.spacer,
  SITE_TYPES.list,
  SITE_TYPES.form,
  SITE_TYPES.menu,
  SITE_TYPES.social,
  SITE_TYPES.embed,
]

/** Types only workspace admins may add (arbitrary third-party markup). */
export const SITE_ADMIN_ONLY_TYPES: string[] = [SITE_TYPES.embed]

export const SITE_CATEGORIES = [
  'Layout',
  'Básicos',
  'Mídia',
  'Navegação',
  'Formulários',
  'Avançado',
] as const

/** Class on the element that wraps a rendered site (theme variables and
 * base styles are scoped to it). */
export const SITE_ROOT_CLASS = 's-site'
