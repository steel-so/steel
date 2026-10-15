import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  compileSiteCss,
  parseSiteTheme,
  SiteDocument,
  type SiteRenderContext,
  siteRuntimeScripts,
} from '@/src/lib/canvas-site'
import { collectFormTokens } from '@/src/lib/sites/document'
import {
  resolveSiteHref,
  SITE_VIA_HOST_HEADER,
  siteLinkBase,
  sitePageUrl,
} from '@/src/lib/sites/host'
import {
  findSnapshotPage,
  globalOf,
  pageTitle,
  publicPathOf,
} from '@/src/lib/sites/snapshot'
import { SiteAnalytics } from '../../../_components/site-analytics'
import { SITE_CHROME_CSS } from '../../../_components/site-chrome-css'
import { loadPublishedSite, loadSiteForms } from '../../../_lib/load'

type PageProps = {
  params: Promise<{ siteSlug: string; path?: string[] }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { siteSlug, path = [] } = await params
  const site = await loadPublishedSite(siteSlug)
  const page = site ? findSnapshotPage(site.snapshot, path) : null
  if (!site || !page) {
    return { title: 'Página não encontrada', robots: { index: false } }
  }

  const { settings } = site.snapshot
  const canonical = sitePageUrl(site.baseUrl, publicPathOf(site.snapshot, page))
  const title = pageTitle(site.snapshot, page)
  const description = page.seo.description || settings.seo.description
  const image = page.seo.socialImageUrl || settings.socialImageUrl
  const noindex = Boolean(settings.seo.noindex || page.seo.noindex)

  return {
    metadataBase: new URL(site.baseUrl),
    title: { absolute: title },
    description,
    applicationName: site.snapshot.name,
    alternates: { canonical },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    icons: settings.faviconUrl ? { icon: settings.faviconUrl } : undefined,
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: site.snapshot.name,
      url: canonical,
      title,
      description,
      images: image ? [image] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : [],
    },
  }
}

/** Header/footer globals render their root as `div` (their sections carry
 * the landmarks); only the page root is `main`. */
function asChrome(doc: CanvasDocument | undefined): CanvasDocument | undefined {
  if (!doc) return undefined
  const root = doc.nodes[doc.rootId]
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [doc.rootId]: { ...root, props: { ...root.props, tag: 'div' } },
    },
  }
}

export default async function PublishedSitePage({ params }: PageProps) {
  const { siteSlug, path = [] } = await params
  const site = await loadPublishedSite(siteSlug)
  if (!site) notFound()
  const page = findSnapshotPage(site.snapshot, path)
  if (!page) notFound()

  const { snapshot } = site
  const header = asChrome(globalOf(snapshot, 'HEADER')?.document)
  const footer = asChrome(globalOf(snapshot, 'FOOTER')?.document)
  const documents = [header, page.document, footer].filter(
    (doc) => doc !== undefined,
  )
  const [forms, requestHeaders] = await Promise.all([
    loadSiteForms(site.slug, site.workspaceId, collectFormTokens(documents)),
    headers(),
  ])
  const linkBase = siteLinkBase(
    site.slug,
    requestHeaders.get(SITE_VIA_HOST_HEADER) === '1',
  )
  const pages = snapshot.pages.map((item) => ({
    id: item.id,
    title: item.title,
    path: resolveSiteHref(`/${publicPathOf(snapshot, item)}`, linkBase),
    parentId: item.parentId,
    showInMenu: !item.seo.noindex,
  }))
  const context: SiteRenderContext = {
    pages,
    currentPageId: page.id,
    pageHref: (pageId) => pages.find((item) => item.id === pageId)?.path,
    forms,
    formAction: (token) => `/api/crm/forms/${encodeURIComponent(token)}/submit`,
  }
  const css = compileSiteCss(documents, {
    theme: parseSiteTheme(snapshot.theme),
  })
  const nonce = requestHeaders.get('x-nonce') ?? undefined
  // Only the scripts of the features this page uses (forms, carousels,
  // popups…), inlined with the CSP nonce; `boot` runs before the content.
  const runtime = siteRuntimeScripts(documents)

  return (
    <>
      {runtime.boot ? (
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: runtime.boot }}
        />
      ) : null}
      {/* Compiled stylesheet of the published site: theme tokens, classes
          and per-breakpoint media queries (no inline styles on elements). */}
      <style>{css}</style>
      <style>{SITE_CHROME_CSS}</style>
      {header ? <SiteDocument doc={header} context={context} /> : null}
      <SiteDocument doc={page.document} context={context} />
      {footer ? <SiteDocument doc={footer} context={context} /> : null}
      {runtime.scripts.map((script) => (
        <script
          key={script.id}
          nonce={nonce}
          data-site-runtime={script.id}
          dangerouslySetInnerHTML={{ __html: script.code }}
        />
      ))}
      <SiteAnalytics
        slug={site.slug}
        pageId={page.id}
        path={`/${publicPathOf(snapshot, page)}`}
        banner={snapshot.settings.cookieBanner}
      />
    </>
  )
}
