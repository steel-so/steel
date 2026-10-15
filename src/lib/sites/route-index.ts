import {
  matchRedirect,
  normalizeSitePath,
  type SiteRedirectRule,
} from './redirects'
import { publicPathOf, type SiteSnapshot } from './snapshot'

/**
 * What the proxy needs to answer a published-site request with the right
 * HTTP status before the page renders (the App Router streams pages with a
 * 200 it cannot take back): the public paths of the live snapshot and the
 * site's redirects. Built by `SitePublicService.routeIndex`, cached in
 * Redis (`site-route.cache.ts`) and expired with the site's cache tag.
 */
export interface SiteRouteIndex {
  published: boolean
  /** Site name (title of the 404 page). */
  name?: string
  /** Normalized public paths (`/` is the home page). */
  paths: string[]
  redirects: SiteRedirectRule[]
}

export const UNPUBLISHED_ROUTE_INDEX: SiteRouteIndex = {
  published: false,
  paths: [],
  redirects: [],
}

export function buildSiteRouteIndex(
  snapshot: SiteSnapshot,
  redirects: SiteRedirectRule[],
  /** Paths of dynamic pages (blog posts, archives, collection items). */
  dynamicPaths: string[] = [],
): SiteRouteIndex {
  return {
    published: true,
    name: snapshot.name,
    paths: [
      ...snapshot.pages.map((page) =>
        normalizeSitePath(`/${publicPathOf(snapshot, page)}`),
      ),
      ...dynamicPaths.map(normalizeSitePath),
    ],
    redirects,
  }
}

export type SiteRouteDecision =
  | { kind: 'page' }
  | { kind: 'redirect'; location: string; permanent: boolean }
  | { kind: 'not-found' }

/** Paths the runtime serves itself (never a page or a redirect). */
const OWN_PATHS = [
  '/sitemap.xml',
  '/robots.txt',
  '/_og',
  // Blog feeds (slice site-blog).
  '/feed.xml',
  '/atom.xml',
]

/** `true` for the runtime's own files, which answer their own status. */
export function isSiteFilePath(rawPath: string): boolean {
  return OWN_PATHS.includes(normalizeSitePath(rawPath))
}

/** Redirects run first (an old address keeps working even when a page
 * took its place), then the page lookup. */
export function decideSiteRoute(
  index: SiteRouteIndex,
  rawPath: string,
): SiteRouteDecision {
  if (!index.published) return { kind: 'not-found' }
  const moved = matchRedirect(index.redirects, rawPath)
  if (moved) return { kind: 'redirect', ...moved }
  return index.paths.includes(normalizeSitePath(rawPath))
    ? { kind: 'page' }
    : { kind: 'not-found' }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The 404 page the proxy answers for a missing page or site: a small
 * standalone document (no scripts, inline styles only), so the status is a
 * real 404 without rendering the App Router page.
 */
export function siteNotFoundHtml(options: {
  siteName?: string
  homeHref?: string
}): string {
  const name = options.siteName ? escapeHtml(options.siteName) : ''
  const title = name
    ? `Página não encontrada | ${name}`
    : 'Página não encontrada'
  const home = options.homeHref
    ? `<a href="${escapeHtml(options.homeHref)}">Ir para a página inicial</a>`
    : ''
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>html,body{margin:0}body{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 16px;box-sizing:border-box;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#161c2d}h1{margin:0;font-size:1.75rem}p{margin:0;color:#5c6272}a{margin-top:8px;color:#1d4ed8;font-weight:600}</style></head><body><main><h1>Página não encontrada</h1><p>O endereço pode ter mudado ou o site não está mais publicado.</p>${home}</main></body></html>`
}
