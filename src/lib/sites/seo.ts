import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { richTextToPlain } from '@/src/lib/canvas-site/sanitize'
import { sitePageUrl } from './host'
import {
  pageTitle,
  publicPathOf,
  type SiteSnapshot,
  type SiteSnapshotPage,
} from './snapshot'

/**
 * SEO of a published page: canonical address, social image (uploaded or
 * the auto-generated card) and the schema.org graph (Organization,
 * WebSite, WebPage, BreadcrumbList and, with an accordion, FAQPage). Pure; the runtime page and the
 * sitemap call it with the published snapshot.
 */

/** Route of the auto-generated social card, under the site's base URL. */
export const SITE_OG_IMAGE_PATH = '_og'
export const SITE_OG_IMAGE_SIZE = { width: 1200, height: 630 }

/** Absolute form of a URL or `/path` against the site's base URL (paths
 * resolve on the app origin, where `/media/` lives). */
export function absoluteUrl(value: string, baseUrl: string): string {
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return value
  }
}

/** Canonical URL of a page: its override or its own public address. */
export function canonicalUrlOf(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
  baseUrl: string,
): string {
  return (
    page.seo.canonicalUrl ?? sitePageUrl(baseUrl, publicPathOf(snapshot, page))
  )
}

/** Social image of a page: its own, the site's, or the generated card. */
export function socialImageOf(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
  baseUrl: string,
): { url: string; generated: boolean } {
  const uploaded = page.seo.socialImageUrl || snapshot.settings.socialImageUrl
  if (uploaded) return { url: absoluteUrl(uploaded, baseUrl), generated: false }
  const query = new URLSearchParams({ page: page.id })
  return {
    url: `${baseUrl}/${SITE_OG_IMAGE_PATH}?${query}`,
    generated: true,
  }
}

/** Ancestors of a page from the top (home first), then the page. */
export function breadcrumbOf(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
): SiteSnapshotPage[] {
  const byId = new Map(snapshot.pages.map((item) => [item.id, item]))
  const chain: SiteSnapshotPage[] = []
  const seen = new Set<string>()
  for (
    let current: SiteSnapshotPage | undefined = page;
    current && !seen.has(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined
  ) {
    seen.add(current.id)
    chain.unshift(current)
  }
  const home =
    snapshot.pages.find((item) => item.id === snapshot.homePageId) ??
    snapshot.pages.find((item) => item.isHome)
  if (home && chain[0]?.id !== home.id) chain.unshift(home)
  return chain
}

type JsonLdNode = Record<string, unknown>

/** Plain text a node and its descendants show (headings, rich text, list
 * items), in document order. Hidden nodes show nothing. */
function nodeText(doc: CanvasDocument, node: CanvasNode | undefined): string {
  if (!node || node.meta?.hidden) return ''
  const own: string[] = []
  const { props } = node
  if (typeof props.html === 'string') own.push(richTextToPlain(props.html))
  else if (typeof props.text === 'string') own.push(props.text.trim())
  if (Array.isArray(props.items)) {
    for (const item of props.items) {
      const text = (item as { text?: unknown } | null)?.text
      if (typeof text === 'string') own.push(text.trim())
    }
  }
  for (const childId of node.children ?? []) {
    own.push(nodeText(doc, doc.nodes[childId]))
  }
  return own.filter(Boolean).join(' ')
}

/** Questions and answers of the page's accordions (title → content), for
 * a FAQPage node. Items without a title or an answer are left out. */
export function faqOf(
  doc: CanvasDocument,
): Array<{ question: string; answer: string }> {
  const faq: Array<{ question: string; answer: string }> = []
  const visit = (id: string) => {
    const node = doc.nodes[id]
    if (!node || node.meta?.hidden) return
    if (node.type === SITE_TYPES.accordionItem) {
      const question =
        typeof node.props.title === 'string' ? node.props.title.trim() : ''
      const answer = (node.children ?? [])
        .map((childId) => nodeText(doc, doc.nodes[childId]))
        .filter(Boolean)
        .join(' ')
      if (question && answer) faq.push({ question, answer })
      return
    }
    for (const childId of node.children ?? []) visit(childId)
  }
  visit(doc.rootId)
  return faq
}

/** schema.org graph of a page, ready for one `application/ld+json`
 * script. */
export function siteJsonLd(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
  baseUrl: string,
): JsonLdNode {
  const { settings } = snapshot
  const siteUrl = `${baseUrl}/`
  const organizationId = `${siteUrl}#organization`
  const websiteId = `${siteUrl}#website`
  const pageUrl = sitePageUrl(baseUrl, publicPathOf(snapshot, page))
  const logo = settings.seo.logoUrl ?? settings.faviconUrl
  const description = page.seo.description || settings.seo.description

  const organization: JsonLdNode = {
    '@type': 'Organization',
    '@id': organizationId,
    name: settings.seo.organizationName || snapshot.name,
    url: siteUrl,
    ...(logo ? { logo: absoluteUrl(logo, baseUrl) } : {}),
    ...(settings.seo.sameAs?.length ? { sameAs: settings.seo.sameAs } : {}),
  }
  const website: JsonLdNode = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: siteUrl,
    name: snapshot.name,
    inLanguage: 'pt-BR',
    publisher: { '@id': organizationId },
  }
  const crumbs = breadcrumbOf(snapshot, page)
  const breadcrumb: JsonLdNode = {
    '@type': 'BreadcrumbList',
    '@id': `${pageUrl}#breadcrumb`,
    itemListElement: crumbs.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.seo.title || item.title,
      item: sitePageUrl(baseUrl, publicPathOf(snapshot, item)),
    })),
  }
  const webPage: JsonLdNode = {
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: pageTitle(snapshot, page),
    ...(description ? { description } : {}),
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId },
    about: { '@id': organizationId },
    breadcrumb: { '@id': `${pageUrl}#breadcrumb` },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: socialImageOf(snapshot, page, baseUrl).url,
    },
  }

  const questions = faqOf(page.document)
  const faq: JsonLdNode[] = questions.length
    ? [
        {
          '@type': 'FAQPage',
          '@id': `${pageUrl}#faq`,
          url: pageUrl,
          inLanguage: 'pt-BR',
          isPartOf: { '@id': websiteId },
          mainEntity: questions.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        },
      ]
    : []

  return {
    '@context': 'https://schema.org',
    '@graph': [organization, website, webPage, breadcrumb, ...faq],
  }
}

/** JSON for an inline `<script type="application/ld+json">`: `<` is
 * escaped so a page title can never close the script. */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Favicon of a site without one: its initial on the primary color, as an
 * SVG data URL (so the browser never falls back to Steel's icon). */
export function fallbackFavicon(name: string, color: string): string {
  const initial = (name.trim().charAt(0) || 'S').toUpperCase()
  const safeInitial = initial.replace(/[^\p{L}\p{N}]/gu, '') || 'S'
  const fill = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#1d4ed8'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${fill}"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${safeInitial}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
