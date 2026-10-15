import { isValidSiteSlug } from './slug'

/**
 * Host routing of published sites. With `SITES_ROOT_DOMAIN` set (e.g.
 * `sites.steel.app`), `clinica.sites.steel.app/contato` is served by
 * `/s/clinica/contato`. The path-based `/s/<slug>` address always works.
 * Pure on purpose: `proxy.ts` runs it on every request.
 */

/** Prefix of the public runtime routes. */
export const SITES_PATH_PREFIX = '/s'

/** Request header the proxy sets on every published-site request (value:
 * the slug). The root layout reads it to keep Steel's own cookie banner,
 * trackers and session lookup off customer sites. */
export const SITE_REQUEST_HEADER = 'x-steel-site'

/** Set (`'1'`) when the site was reached on its own host, so links are
 * written from `/` instead of `/s/<slug>`. */
export const SITE_VIA_HOST_HEADER = 'x-steel-site-host'

/** Prefix of the site's internal links: `''` on its own host, `/s/<slug>`
 * on the app domain. */
export function siteLinkBase(slug: string, viaHost: boolean): string {
  return viaHost ? '' : `${SITES_PATH_PREFIX}/${slug}`
}

/** Internal link (`/contato`, `#precos`) rewritten for the current address;
 * external, mail and phone links are kept. */
export function resolveSiteHref(href: string, linkBase: string): string {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return `${linkBase}${href}` || '/'
  }
  return href
}

/** Slug of a path-based site request (`/s/<slug>/…`), else `null`. */
export function siteSlugFromPath(pathname: string): string | null {
  const match = /^\/s\/([^/]+)(?:\/|$)/.exec(pathname)
  return match && isValidSiteSlug(match[1]) ? match[1] : null
}

/** Paths a site host keeps as-is: framework assets and the public APIs the
 * runtime calls (view beacon, CRM form submissions). */
const PASSTHROUGH_PREFIXES = ['/_next/', '/api/', '/media/']

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
}

/** Slug addressed by `host` under `rootDomain`, or `null` when the host is
 * not a site subdomain (the app itself, the bare root, nested labels). */
export function parseSiteHost(
  host: string | null | undefined,
  rootDomain: string | null | undefined,
): string | null {
  if (!host || !rootDomain) return null
  const root = normalizeDomain(rootDomain)
  if (!root) return null
  const hostname = normalizeDomain(host.replace(/:\d+$/, ''))
  const suffix = `.${root}`
  if (!hostname.endsWith(suffix)) return null
  const label = hostname.slice(0, -suffix.length)
  if (label.includes('.') || !isValidSiteSlug(label)) return null
  return label
}

/** Internal path a site-host request is rewritten to, or `null` when the
 * path must pass through untouched. */
export function siteRewritePath(slug: string, pathname: string): string | null {
  if (PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null
  }
  const rest = pathname === '/' ? '' : pathname
  return `${SITES_PATH_PREFIX}/${slug}${rest}`
}

/**
 * Public base URL of a site: the subdomain when a root domain is set
 * (`https://clinica.sites.steel.app`), else the path under the app
 * (`https://app.steel/s/clinica`). The subdomain keeps the app's scheme.
 */
export function siteBaseUrl(
  slug: string,
  options: { appUrl: string; rootDomain?: string | null },
): string {
  const app = new URL(options.appUrl)
  const root = options.rootDomain ? normalizeDomain(options.rootDomain) : ''
  if (root) {
    const port = app.port ? `:${app.port}` : ''
    return `${app.protocol}//${slug}.${root}${port}`
  }
  return `${app.origin}${SITES_PATH_PREFIX}/${slug}`
}

/** Absolute URL of a page path (`''` is the home page). */
export function sitePageUrl(baseUrl: string, path: string): string {
  return path ? `${baseUrl}/${path}` : baseUrl
}
