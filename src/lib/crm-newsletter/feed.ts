/**
 * Tolerant RSS 2.0 / Atom reader for the newsletter digest (newsletter2
 * nl2-digest-ai). No XML library: feeds are small (the fetch caps them at
 * 1 MB) and only a handful of fields matter — title, link, summary, date
 * and image of each entry. CDATA, XML entities and the usual image spots
 * (`enclosure`, `media:content`, `media:thumbnail`, the first `<img>` of
 * the summary) are handled; markup in the summary is reduced to text.
 */

export type FeedItem = {
  title: string
  url: string
  excerpt: string
  imageUrl: string | null
  publishedAt: Date | null
}

export type ParsedFeed = {
  title: string
  items: FeedItem[]
}

/** Longest excerpt kept per entry (the e-mail block caps at 400). */
export const FEED_EXCERPT_MAX = 280
/** Entries read from one feed. */
export const FEED_MAX_ITEMS = 50

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    },
  )
}

/** Inner text of a raw XML fragment: CDATA unwrapped, entities decoded. */
function xmlText(raw: string): string {
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) =>
    // Keep CDATA content literal: protect it from a second decoding pass.
    String(inner).replace(/&/g, '&amp;'),
  )
  return decodeEntities(cdata).trim()
}

/** Plain text of an HTML summary, collapsed and capped. */
export function htmlToText(html: string, max = FEED_EXCERPT_MAX): string {
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Raw inner XML of the first `<tag>` (namespace prefix allowed in `tag`). */
function inner(xml: string, tag: string): string | null {
  const name = escapeRegExp(tag)
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,
    'i',
  ).exec(xml)
  return match ? match[1] : null
}

/** Attribute of the first self-closing or open `<tag …>`. */
function attr(xml: string, tag: string, name: string, where?: RegExp) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\s[^>]*>`, 'gi')
  for (const match of xml.matchAll(pattern)) {
    const element = match[0]
    if (where && !where.test(element)) continue
    const value = new RegExp(
      `\\s${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`,
      'i',
    ).exec(element)
    if (value) return decodeEntities(value[2] ?? value[3] ?? '').trim()
  }
  return null
}

function blocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  return [...xml.matchAll(pattern)].map((match) => match[1])
}

export function parseFeedDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value.trim())
  return Number.isNaN(date.getTime()) ? null : date
}

/** `http(s)` absolute URL, resolved against `base` when relative. */
export function absoluteUrl(
  value: string | null,
  base?: string,
): string | null {
  if (!value) return null
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function firstImageIn(html: string): string | null {
  const match = /<img\s[^>]*src\s*=\s*("([^"]*)"|'([^']*)')/i.exec(
    decodeEntities(html),
  )
  return match ? (match[2] ?? match[3] ?? null) : null
}

function imageOf(entry: string, summaryHtml: string): string | null {
  return (
    attr(entry, 'enclosure', 'url', /type\s*=\s*["']image\//i) ??
    attr(
      entry,
      'media:content',
      'url',
      /medium\s*=\s*["']image|type\s*=\s*["']image\//i,
    ) ??
    attr(entry, 'media:thumbnail', 'url') ??
    attr(entry, 'media:content', 'url') ??
    firstImageIn(summaryHtml)
  )
}

function rssItem(entry: string, base?: string): FeedItem | null {
  const title = htmlToText(xmlText(inner(entry, 'title') ?? ''), 200)
  const link =
    absoluteUrl(xmlText(inner(entry, 'link') ?? ''), base) ??
    absoluteUrl(xmlText(inner(entry, 'guid') ?? ''), base)
  if (!title || !link) return null
  const summary = xmlText(
    inner(entry, 'description') ?? inner(entry, 'content:encoded') ?? '',
  )
  return {
    title,
    url: link,
    excerpt: htmlToText(summary),
    imageUrl: absoluteUrl(imageOf(entry, summary), link),
    publishedAt: parseFeedDate(
      xmlText(inner(entry, 'pubDate') ?? inner(entry, 'dc:date') ?? ''),
    ),
  }
}

function atomLink(entry: string): string | null {
  for (const match of entry.matchAll(/<link\s[^>]*>/gi)) {
    const element = match[0]
    const rel = /\srel\s*=\s*["']([^"']*)["']/i.exec(element)?.[1]
    if (rel && rel !== 'alternate') continue
    const href = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(element)
    if (href) return decodeEntities(href[2] ?? href[3] ?? '')
  }
  return null
}

function atomEntry(entry: string, base?: string): FeedItem | null {
  const title = htmlToText(xmlText(inner(entry, 'title') ?? ''), 200)
  const link = absoluteUrl(atomLink(entry), base)
  if (!title || !link) return null
  const summary = xmlText(
    inner(entry, 'summary') ?? inner(entry, 'content') ?? '',
  )
  return {
    title,
    url: link,
    excerpt: htmlToText(summary),
    imageUrl: absoluteUrl(imageOf(entry, summary), link),
    publishedAt: parseFeedDate(
      xmlText(inner(entry, 'published') ?? inner(entry, 'updated') ?? ''),
    ),
  }
}

/**
 * Entries of an RSS 2.0 or Atom document, in feed order; `null` when the
 * text is neither. Entries without title or a usable link are dropped.
 */
export function parseFeed(xml: string, baseUrl?: string): ParsedFeed | null {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '')
  if (/<feed[\s>]/i.test(body)) {
    const head = body.split(/<entry[\s>]/i)[0]
    return {
      title: htmlToText(xmlText(inner(head, 'title') ?? ''), 200),
      items: blocks(body, 'entry')
        .slice(0, FEED_MAX_ITEMS)
        .map((entry) => atomEntry(entry, baseUrl))
        .filter((item): item is FeedItem => item !== null),
    }
  }
  if (/<rss[\s>]|<rdf:RDF[\s>]|<channel[\s>]/i.test(body)) {
    const head = body.split(/<item[\s>]/i)[0]
    return {
      title: htmlToText(xmlText(inner(head, 'title') ?? ''), 200),
      items: blocks(body, 'item')
        .slice(0, FEED_MAX_ITEMS)
        .map((entry) => rssItem(entry, baseUrl))
        .filter((item): item is FeedItem => item !== null),
    }
  }
  return null
}
