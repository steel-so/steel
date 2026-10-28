/**
 * Static CSP audit of the `<script>` elements in a rendered page: decides,
 * the way a browser would, which of them the page's `script-src` blocks.
 *
 * Why it exists: Next 16.4 started inlining the Turbopack chunk-group
 * bootstrap (`<script id="_R_">`) into the static shell that Cache Components
 * prerenders at build time, where no CSP nonce exists. The browser refused it
 * and no page hydrated, while every HTTP-level test stayed green. The e2e
 * guard (`app/(public)/__tests__/csp-hydration.e2e.test.ts`) runs this over
 * real responses of `next start`, so an inline script without the request's
 * nonce fails CI instead of reaching homologação.
 *
 * One inline script is knowingly left blocked: React's shell-time marker
 * (`REACT_SHELL_TIME_SCRIPT`), which the static shell also carries without
 * the nonce. It only records when the shell painted, the reveal code works
 * without it, and ADR 0011 documents it as the one harmless violation —
 * callers pass it in `allowInline`, matched by its exact text only.
 *
 * Deliberately small: nonce and host sources, `'self'`, `'strict-dynamic'`
 * and `'unsafe-inline'`. Hashes are not supported on purpose — the app does
 * not use them, and a script allowed only by a hash would show up here as
 * blocked, which is the conservative answer.
 */

export interface ScriptElement {
  /** The opening tag as written in the HTML (for failure messages). */
  tag: string
  attrs: Record<string, string>
  /** Text between `<script>` and `</script>`. */
  body: string
}

/**
 * React's shell-time marker (`react-dom/server`, `shellTimeRuntimeScript`):
 * emitted inline in the prerendered shell when boundaries are still pending.
 */
export const REACT_SHELL_TIME_SCRIPT =
  'requestAnimationFrame(function(){$RT=performance.now()});'

export interface BlockedScript {
  tag: string
  reason: string
  /** First characters of an inline script's text, to tell which one it is. */
  snippet?: string
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** JavaScript MIME types the HTML spec treats as classic scripts. */
const JS_MIME_RE =
  /^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?$|^text\/(?:jscript|livescript)$/i

/** `<script>` types the browser executes, so CSP applies to them. */
const EXECUTED_NON_MIME_TYPES = new Set([
  'module',
  'importmap',
  'speculationrules',
])

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parseScripts(html: string): ScriptElement[] {
  const scripts: ScriptElement[] = []
  for (const match of html.matchAll(SCRIPT_RE)) {
    const rawAttrs = match[1] ?? ''
    const attrs: Record<string, string> = {}
    for (const attr of rawAttrs.matchAll(ATTR_RE)) {
      const name = attr[1].toLowerCase()
      if (name in attrs) continue // the HTML parser keeps the first one
      attrs[name] = decodeAttr(attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    scripts.push({ tag: `<script${rawAttrs}>`, attrs, body: match[2] ?? '' })
  }
  return scripts
}

/**
 * Whether the browser runs this element (data blocks such as
 * `application/ld+json` are never executed, so CSP ignores them).
 */
export function isExecutable(script: ScriptElement): boolean {
  const type = script.attrs.type?.trim().toLowerCase()
  if (type === undefined || type === '') return true
  return JS_MIME_RE.test(type) || EXECUTED_NON_MIME_TYPES.has(type)
}

/** Source list of the directive that governs `<script>` elements. */
export function scriptSources(csp: string): string[] | null {
  const directives = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (!name) continue
    const key = name.toLowerCase()
    // A repeated directive is ignored by the browser: first one wins.
    if (!directives.has(key)) directives.set(key, values)
  }
  return (
    directives.get('script-src-elem') ??
    directives.get('script-src') ??
    directives.get('default-src') ??
    null
  )
}

export function cspNonce(csp: string): string | null {
  const sources = scriptSources(csp) ?? []
  for (const source of sources) {
    const match = /^'nonce-([^']+)'$/.exec(source)
    if (match) return match[1]
  }
  return null
}

function hostSourceMatches(source: string, url: URL): boolean {
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
    return source.toLowerCase() === url.protocol
  }
  const match =
    /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(
      source,
    )
  if (!match) return false
  const [, scheme, wildcard, host, port, path] = match
  if (scheme && `${scheme.toLowerCase()}:` !== url.protocol) return false
  if (!scheme && url.protocol !== 'https:' && url.protocol !== 'http:')
    return false
  const hostname = url.hostname.toLowerCase()
  const expected = host.toLowerCase()
  if (wildcard) {
    if (!hostname.endsWith(`.${expected}`)) return false
  } else if (hostname !== expected) {
    return false
  }
  if (port && port !== '*' && url.port !== port) return false
  if (path && path !== '/' && !url.pathname.startsWith(path)) return false
  return true
}

/**
 * Every executable `<script>` in `html` that the `csp` header would block
 * on a page served from `pageUrl`. An empty list means the browser runs
 * them all.
 */
export function scriptsBlockedByCsp(
  html: string,
  csp: string,
  pageUrl: string,
  options: {
    /** Exact bodies of inline scripts known to be blocked and harmless. */
    allowInline?: readonly string[]
  } = {},
): BlockedScript[] {
  const allowInline = new Set(options.allowInline ?? [])
  const sources = scriptSources(csp)
  if (sources === null) return []
  const page = new URL(pageUrl)
  const nonces = new Set(
    sources
      .map((source) => /^'nonce-([^']+)'$/.exec(source)?.[1])
      .filter((nonce): nonce is string => Boolean(nonce)),
  )
  const strictDynamic = sources.includes("'strict-dynamic'")
  const allowsSelf = sources.includes("'self'")
  // CSP3: 'unsafe-inline' is ignored once a nonce or 'strict-dynamic' is set.
  const unsafeInline =
    sources.includes("'unsafe-inline'") && nonces.size === 0 && !strictDynamic
  const hostSources = sources.filter((source) => !source.startsWith("'"))

  const blocked: BlockedScript[] = []
  for (const script of parseScripts(html)) {
    if (!isExecutable(script)) continue
    const nonce = script.attrs.nonce
    if (nonce !== undefined && nonces.has(nonce)) continue

    const src = script.attrs.src
    if (src === undefined) {
      if (unsafeInline || allowInline.has(script.body)) continue
      blocked.push({
        tag: script.tag,
        reason:
          nonce === undefined
            ? 'inline script without the CSP nonce'
            : 'inline script with a nonce that is not the CSP nonce',
        snippet: script.body.trim().slice(0, 160),
      })
      continue
    }

    if (strictDynamic) {
      blocked.push({
        tag: script.tag,
        reason: "external script without the nonce under 'strict-dynamic'",
      })
      continue
    }
    const url = new URL(src, page)
    if (allowsSelf && url.origin === page.origin) continue
    if (hostSources.some((source) => hostSourceMatches(source, url))) continue
    blocked.push({
      tag: script.tag,
      reason: `external script from ${url.origin} not allowed by script-src`,
    })
  }
  return blocked
}
