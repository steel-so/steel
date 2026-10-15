/**
 * RSS 2.0 and Atom feeds of a site's blog (whole blog or one category).
 * Pure string builders; the runtime serves them at `/feed.xml` and
 * `/atom.xml`.
 */

export interface FeedEntry {
  title: string
  url: string
  /** Stable id (the post URL). */
  id: string
  publishedAt: string
  updatedAt: string
  summary: string
  /** Full sanitized HTML of the post. */
  contentHtml: string
  categories: string[]
  author?: string | null
  imageUrl?: string | null
}

export interface FeedChannel {
  title: string
  description: string
  /** Public URL of the blog. */
  link: string
  /** URL of this feed. */
  feedUrl: string
  updatedAt: string
  entries: FeedEntry[]
}

/** Entries per feed (newest first). */
export const FEED_LIMIT = 50

/** XML 1.0 forbids most control characters (tab, LF and CR are kept). */
function stripControl(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += char
  }
  return out
}

export function escapeXml(value: string): string {
  return stripControl(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** HTML inside CDATA (a literal `]]>` is split so it cannot end it). */
function cdata(html: string): string {
  return `<![CDATA[${stripControl(html).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

export function renderRss(channel: FeedChannel): string {
  const items = channel.entries
    .slice(0, FEED_LIMIT)
    .map((entry) => {
      const categories = entry.categories
        .map((name) => `<category>${escapeXml(name)}</category>`)
        .join('')
      const author = entry.author
        ? `<dc:creator>${escapeXml(entry.author)}</dc:creator>`
        : ''
      const image = entry.imageUrl
        ? `<enclosure url="${escapeXml(entry.imageUrl)}" type="image/jpeg" length="0"/>`
        : ''
      return `    <item><title>${escapeXml(entry.title)}</title><link>${escapeXml(entry.url)}</link><guid isPermaLink="true">${escapeXml(entry.id)}</guid><pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>${author}${categories}<description>${escapeXml(entry.summary)}</description><content:encoded>${cdata(entry.contentHtml)}</content:encoded>${image}</item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>pt-BR</language>
    <lastBuildDate>${new Date(channel.updatedAt).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`
}

export function renderAtom(channel: FeedChannel): string {
  const entries = channel.entries
    .slice(0, FEED_LIMIT)
    .map((entry) => {
      const categories = entry.categories
        .map((name) => `<category term="${escapeXml(name)}"/>`)
        .join('')
      const author = entry.author
        ? `<author><name>${escapeXml(entry.author)}</name></author>`
        : ''
      return `  <entry><title>${escapeXml(entry.title)}</title><link rel="alternate" type="text/html" href="${escapeXml(entry.url)}"/><id>${escapeXml(entry.id)}</id><published>${new Date(entry.publishedAt).toISOString()}</published><updated>${new Date(entry.updatedAt).toISOString()}</updated>${author}${categories}<summary>${escapeXml(entry.summary)}</summary><content type="html">${escapeXml(entry.contentHtml)}</content></entry>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="pt-BR">
  <title>${escapeXml(channel.title)}</title>
  <subtitle>${escapeXml(channel.description)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(channel.link)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(channel.feedUrl)}"/>
  <id>${escapeXml(channel.feedUrl)}</id>
  <updated>${new Date(channel.updatedAt).toISOString()}</updated>
${entries}
</feed>
`
}
