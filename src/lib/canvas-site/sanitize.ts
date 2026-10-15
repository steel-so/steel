/**
 * Output safety of the site catalog. Everything here runs without a DOM
 * (server render, editor, tests): rich text is reduced to an allowlist,
 * URLs are checked by scheme before they reach `href`/`src`.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#|\/(?!\/)|\?)/i

/** `href` that cannot run script: http(s), mailto, tel, same-site paths
 * and anchors. Anything else (`javascript:`, `data:`, protocol-relative)
 * gives `undefined`. */
export function safeHref(value: string | undefined): string | undefined {
  const href = value?.trim()
  if (!href) return undefined
  return SAFE_HREF.test(href) ? href : undefined
}

const SAFE_SRC =
  /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,])/i

/** `src` of an image or video: http(s), same-site paths or an inline
 * image data URL. */
export function safeSrc(value: string | undefined): string | undefined {
  const src = value?.trim()
  if (!src) return undefined
  return SAFE_SRC.test(src) ? src : undefined
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const RICH_ALLOWED = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'span',
])

const RICH_VOID = new Set(['br'])

const RICH_DROP_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
  'textarea',
  'select',
  'title',
  'head',
]

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g

function readAttr(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )
  if (!match) return null
  return (match[2] ?? match[3] ?? match[4] ?? '').trim()
}

/**
 * Rich text of `site.text` (TipTap marks: bold, italic, underline, strike,
 * link, lists). Tags outside the allowlist are removed (dangerous ones with
 * their content), attributes are dropped except a safe `href` and
 * `target="_blank"` (which gets `rel="noopener noreferrer"`).
 */
export function sanitizeRichText(input: string): string {
  let html = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '')
  for (const tag of RICH_DROP_WITH_CONTENT) {
    html = html.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'),
      '',
    )
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  return html.replace(TAG, (_match, close: string, raw: string, attrs) => {
    const name = raw.toLowerCase()
    if (!RICH_ALLOWED.has(name)) return ''
    if (close) return RICH_VOID.has(name) ? '' : `</${name}>`
    if (RICH_VOID.has(name)) return `<${name}>`
    if (name !== 'a') return `<${name}>`
    const href = safeHref(readAttr(attrs, 'href')?.replace(/&amp;/g, '&'))
    if (!href) return '<a>'
    const blank = readAttr(attrs, 'target') === '_blank'
    return `<a href="${escapeHtml(href)}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>`
  })
}

/** Plain text of rich text (heading fallbacks, accessible names). */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── video ────────────────────────────────────────────────────────────────

/** YouTube id from a watch, share, shorts or embed URL (or a bare id). */
export function youtubeId(url: string): string | null {
  const value = url.trim()
  if (/^[\w-]{11}$/.test(value)) return value
  const match = value.match(
    /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i,
  )
  return match ? match[1] : null
}

/** Vimeo id from a page or player URL (or a bare numeric id). */
export function vimeoId(url: string): string | null {
  const value = url.trim()
  if (/^\d{6,12}$/.test(value)) return value
  const match = value.match(
    /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/i,
  )
  return match ? match[1] : null
}

/** Embed URL of a hosted video; `null` when the URL is not recognized. */
export function videoEmbedUrl(
  source: 'youtube' | 'vimeo',
  url: string,
  options: {
    autoplay: boolean
    muted: boolean
    loop: boolean
    controls: boolean
  },
): string | null {
  const flag = (value: boolean) => (value ? '1' : '0')
  if (source === 'youtube') {
    const id = youtubeId(url)
    if (!id) return null
    const params = new URLSearchParams({
      autoplay: flag(options.autoplay),
      mute: flag(options.muted),
      controls: flag(options.controls),
      rel: '0',
    })
    if (options.loop) {
      params.set('loop', '1')
      params.set('playlist', id)
    }
    return `https://www.youtube.com/embed/${id}?${params}`
  }
  const id = vimeoId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: flag(options.autoplay),
    muted: flag(options.muted),
    loop: flag(options.loop),
    controls: flag(options.controls),
    dnt: '1',
  })
  return `https://player.vimeo.com/video/${id}?${params}`
}
