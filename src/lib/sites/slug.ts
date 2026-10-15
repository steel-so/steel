/**
 * Slugs of the site builder. A site slug doubles as a DNS label
 * (`<slug>.<SITES_ROOT_DOMAIN>`), so it follows the hostname rules: lower
 * case letters, digits and inner hyphens, 3–63 characters, never `xn--`
 * (punycode) and never one of the names the platform keeps for itself.
 */

export const SITE_SLUG_MIN = 3
export const SITE_SLUG_MAX = 63
export const PAGE_SLUG_MAX = 80

const SITE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Subdomains that must never resolve to a customer site. */
export const RESERVED_SITE_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'cdn',
  'dashboard',
  'dev',
  'docs',
  'ftp',
  'help',
  'homolog',
  'homologacao',
  'imap',
  'ingest',
  'mail',
  'media',
  'minio',
  'pop',
  'portal',
  'realtime',
  'smtp',
  'static',
  'status',
  'steel',
  'stratus',
  'suporte',
  'support',
  'webmail',
  'www',
])

export function isValidSiteSlug(slug: string): boolean {
  return (
    slug.length >= SITE_SLUG_MIN &&
    slug.length <= SITE_SLUG_MAX &&
    SITE_SLUG_PATTERN.test(slug) &&
    !slug.startsWith('xn--') &&
    !RESERVED_SITE_SLUGS.has(slug)
  )
}

export function isValidPageSlug(slug: string): boolean {
  return slug.length <= PAGE_SLUG_MAX && PAGE_SLUG_PATTERN.test(slug)
}

/** Lower-case ASCII slug: accents dropped, anything else becomes `-`. */
export function slugify(input: string, maxLength = SITE_SLUG_MAX): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}

/** A valid site slug derived from a name (`Clínica São Lucas` →
 * `clinica-sao-lucas`); short or reserved names get a `-site` suffix. */
export function siteSlugFromName(name: string): string {
  const base = slugify(name, SITE_SLUG_MAX - 5)
  if (isValidSiteSlug(base)) return base
  const suffixed = base ? `${base}-site` : 'meu-site'
  return isValidSiteSlug(suffixed) ? suffixed : 'meu-site'
}

/** `base`, then `base-2`, `base-3`… trimmed to fit the 63-char label. */
export function slugWithSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base
  const suffix = `-${attempt}`
  return `${base.slice(0, SITE_SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`
}

/** A valid page slug derived from a title (`Quem somos` → `quem-somos`). */
export function pageSlugFromTitle(title: string): string {
  return slugify(title, PAGE_SLUG_MAX) || 'pagina'
}

/** Full path of a page: the parent path plus its own slug. */
export function joinPagePath(parentPath: string | null, slug: string): string {
  return parentPath ? `${parentPath}/${slug}` : slug
}
