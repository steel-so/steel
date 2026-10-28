import { escapeXml } from '@/src/lib/sites/blog/feeds'
import type { PublicNewsletterFeedDTO } from '@/src/schemas/crm-newsletter-archive.schema'
import {
  newsletterArchiveUrl,
  newsletterIssueUrl,
  newsletterRssUrl,
} from './urls'

/**
 * RSS 2.0 of a newsletter's public archive (`/n/<ws>/<newsletter>/rss.xml`).
 * Pure. Each item carries the excerpt as its description and links to the
 * web version; the full HTML stays on the web page (an e-mail layout inside
 * a feed reader renders poorly and would make the feed heavy).
 */
export function renderNewsletterRss(
  feed: PublicNewsletterFeedDTO,
  baseUrl: string,
): string {
  const { workspaceSlug } = feed
  const { slug, name } = feed.newsletter
  const link = newsletterArchiveUrl(baseUrl, workspaceSlug, slug)
  const description =
    feed.newsletter.description ||
    `Edições de ${name}, de ${feed.workspaceName}.`
  const items = feed.issues
    .map((issue) => {
      const url = newsletterIssueUrl(baseUrl, workspaceSlug, slug, issue.slug)
      const summary = issue.excerpt
        ? `<description>${escapeXml(issue.excerpt)}</description>`
        : ''
      return `    <item><title>${escapeXml(`#${issue.number} — ${issue.subject}`)}</title><link>${escapeXml(url)}</link><guid isPermaLink="true">${escapeXml(url)}</guid><pubDate>${new Date(issue.sentAt).toUTCString()}</pubDate>${summary}</item>`
    })
    .join('\n')
  const lastBuild = feed.issues[0]?.sentAt
  const image = feed.newsletter.logoUrl
    ? `\n    <image><url>${escapeXml(feed.newsletter.logoUrl)}</url><title>${escapeXml(name)}</title><link>${escapeXml(link)}</link></image>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(name)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>pt-BR</language>${lastBuild ? `\n    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>` : ''}
    <atom:link href="${escapeXml(newsletterRssUrl(baseUrl, workspaceSlug, slug))}" rel="self" type="application/rss+xml"/>${image}
${items}
  </channel>
</rss>
`
}
