import { escapeHtml } from '@/src/lib/crm-email-builder/variables'
import { isEmailBuilderLink } from '@/src/schemas/crm-email-builder.schema'

/**
 * Sanitizer of the `email.html` block (admins only). Wider than the rich-text
 * allowlist — tables, images, inline styles — but still an allowlist: no
 * scripts, event handlers, forms, frames or `javascript:` URLs. Runs without
 * a DOM (server, worker and browser).
 */

const ALLOWED_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'div',
  'span',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'sup',
  'sub',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'blockquote',
  'center',
  'font',
])

const VOID_TAGS = new Set(['br', 'hr', 'img'])

const DROP_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'template',
  'noscript',
  'svg',
  'math',
  'textarea',
  'select',
  'title',
  'head',
  'form',
  'button',
]

const COMMON_ATTRS = new Set([
  'style',
  'align',
  'valign',
  'width',
  'height',
  'bgcolor',
  'title',
  'dir',
  'lang',
  'role',
])

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target']),
  img: new Set(['src', 'alt', 'border']),
  table: new Set(['border', 'cellpadding', 'cellspacing']),
  td: new Set(['colspan', 'rowspan', 'nowrap']),
  th: new Set(['colspan', 'rowspan', 'nowrap', 'scope']),
  font: new Set(['color', 'face', 'size']),
}

/** A tag, or a lone `<`/`>` (escaped, so a half-written tag can never
 * become markup next to what follows the block). */
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|[<>]/g
const ATTR =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Inline CSS without anything that can run code or load arbitrary URLs. */
function safeStyle(value: string): string | null {
  const lowered = value.toLowerCase().replace(/\s+/g, '')
  if (
    /expression\(|javascript:|vbscript:|behavior:|-moz-binding|@import|<|\\/.test(
      lowered,
    )
  ) {
    return null
  }
  const urls = lowered.match(/url\(([^)]*)\)/g) ?? []
  for (const url of urls) {
    const target = url.slice(4, -1).replace(/^['"]|['"]$/g, '')
    if (!/^https:\/\//.test(target)) return null
  }
  return value
}

function safeAttr(tag: string, name: string, raw: string): string | null {
  const value = decode(raw).trim()
  if (name === 'href') return isEmailBuilderLink(value) && value ? value : null
  if (name === 'src') return /^https:\/\//i.test(value) ? value : null
  if (name === 'style') return safeStyle(value)
  if (name === 'target') return value === '_blank' ? value : null
  if (tag === 'font' && name === 'face') return value.replace(/[<>"]/g, '')
  return value
}

function cleanAttrs(tag: string, attrs: string): string {
  const allowed = TAG_ATTRS[tag]
  const out: string[] = []
  for (const match of attrs.matchAll(ATTR)) {
    const name = match[1].toLowerCase()
    if (!COMMON_ATTRS.has(name) && !allowed?.has(name)) continue
    const raw = match[2] ?? match[3] ?? match[4] ?? ''
    const value = safeAttr(tag, name, raw)
    if (value === null) continue
    out.push(`${name}="${escapeHtml(value)}"`)
  }
  return out.length > 0 ? ` ${out.join(' ')}` : ''
}

export function sanitizeEmailHtml(input: string): string {
  let html = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'),
      '',
    )
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  return html.replace(TOKEN, (match, close, rawName, attrs) => {
    if (rawName === undefined) return match === '<' ? '&lt;' : '&gt;'
    const name = (rawName as string).toLowerCase()
    if (!ALLOWED_TAGS.has(name)) return ''
    if (close) return VOID_TAGS.has(name) ? '' : `</${name}>`
    const clean = cleanAttrs(name, (attrs as string).replace(/\/\s*$/, ''))
    return `<${name}${clean}>`
  })
}
