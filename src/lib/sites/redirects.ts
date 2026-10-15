/**
 * Redirects of a published site (old address → new one). Pure on purpose:
 * the schema normalizes with it, the service checks loops with it and the
 * public runtime matches every request with it.
 *
 * A source is an exact path (`/antigo`) or a prefix ending in `/*`
 * (`/blog/*`). A prefix target ending in `/*` carries the rest of the path
 * (`/blog/*` → `/novidades/*` sends `/blog/a/b` to `/novidades/a/b`).
 */

export interface SiteRedirectRule {
  fromPath: string
  toPath: string
  permanent: boolean
}

/** Paths the runtime serves itself; a redirect cannot start there. */
export const RESERVED_REDIRECT_PATHS = [
  '/',
  '/sitemap.xml',
  '/robots.txt',
  '/_og',
]

const SOURCE_PATTERN = /^\/[a-z0-9\-._~%/]*(\/\*)?$/

/**
 * Canonical form of a request or source path: lower case, no query or
 * fragment, no repeated or trailing slashes (`/Blog//Post/?x=1` →
 * `/blog/post`). `/` stays `/`.
 */
export function normalizeSitePath(input: string): string {
  const path = input.trim().split(/[?#]/)[0] ?? ''
  const withSlash = path.startsWith('/') ? path : `/${path}`
  const collapsed = withSlash.replace(/\/{2,}/g, '/').toLowerCase()
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : '/'
}

/** A normalized source (`/antigo` or `/blog/*`), or `null` when invalid. */
export function normalizeRedirectSource(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  const wildcard = /\/\*$/.test(trimmed)
  const base = normalizeSitePath(wildcard ? trimmed.slice(0, -2) : trimmed)
  const source = wildcard ? `${base === '/' ? '' : base}/*` : base
  if (!SOURCE_PATTERN.test(source)) return null
  if (source === '/*' || RESERVED_REDIRECT_PATHS.includes(source)) return null
  return source
}

/** Target accepted by a redirect: a site path (`/novo`, `/novo#form`) or an
 * absolute http(s) URL. */
export function isValidRedirectTarget(input: string): boolean {
  const value = input.trim()
  if (/^https?:\/\/[^\s/]+/i.test(value)) return !/\s/.test(value)
  return /^\/(?!\/)[^\s]*$/.test(value)
}

function isPrefix(source: string): boolean {
  return source.endsWith('/*')
}

/** Where `rule` sends `path` (already normalized), or `null` when it does
 * not apply. */
export function applyRedirect(
  rule: SiteRedirectRule,
  path: string,
): string | null {
  if (!isPrefix(rule.fromPath)) {
    return rule.fromPath === path ? rule.toPath : null
  }
  const base = rule.fromPath.slice(0, -2)
  if (path !== base && !path.startsWith(`${base}/`)) return null
  if (!rule.toPath.endsWith('/*')) return rule.toPath
  const rest = path.slice(base.length)
  const target = rule.toPath.slice(0, -2)
  return `${target}${rest}` || '/'
}

/**
 * The redirect for a request path: an exact source wins over prefixes, and
 * a longer prefix over a shorter one.
 */
export function matchRedirect(
  rules: SiteRedirectRule[],
  rawPath: string,
): { location: string; permanent: boolean } | null {
  const path = normalizeSitePath(rawPath)
  const exact = rules.find(
    (rule) => !isPrefix(rule.fromPath) && rule.fromPath === path,
  )
  if (exact) return { location: exact.toPath, permanent: exact.permanent }
  const prefixes = rules
    .filter((rule) => isPrefix(rule.fromPath))
    .sort((a, b) => b.fromPath.length - a.fromPath.length)
  for (const rule of prefixes) {
    const location = applyRedirect(rule, path)
    if (location) return { location, permanent: rule.permanent }
  }
  return null
}

/** Internal path of a target (`/novo#x` → `/novo`), `null` for URLs. */
function internalPath(target: string): string | null {
  if (!target.startsWith('/')) return null
  return normalizeSitePath(target.replace(/\/\*$/, ''))
}

/**
 * `true` when adding `candidate` to `rules` makes some path redirect back
 * to itself (directly or through a chain). Followed hop by hop from the
 * candidate's source, as a visitor would.
 */
export function createsRedirectLoop(
  rules: SiteRedirectRule[],
  candidate: SiteRedirectRule,
): boolean {
  const all = [
    ...rules.filter((rule) => rule.fromPath !== candidate.fromPath),
    candidate,
  ]
  const start = isPrefix(candidate.fromPath)
    ? `${candidate.fromPath.slice(0, -2)}/loop-probe`
    : candidate.fromPath
  const seen = new Set<string>([normalizeSitePath(start)])
  let current = normalizeSitePath(start)
  for (let hop = 0; hop <= all.length; hop++) {
    const match = matchRedirect(all, current)
    if (!match) return false
    const next = internalPath(match.location)
    if (!next) return false
    if (seen.has(next)) return true
    seen.add(next)
    current = next
  }
  return true
}
