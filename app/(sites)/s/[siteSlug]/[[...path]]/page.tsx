import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { NODE_ENV } from '@/lib/env/env'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  compileSiteCss,
  parseSiteTheme,
  SiteDocument,
  type SiteRenderContext,
  siteRuntimeScripts,
  usedSymbolIds,
} from '@/src/lib/canvas-site'
import { siteMetaCsp } from '@/src/lib/sites/csp'
import { collectFormTokens } from '@/src/lib/sites/document'
import {
  resolveSiteHref,
  SITE_VIA_HOST_HEADER,
  siteLinkBase,
} from '@/src/lib/sites/host'
import { matchRedirect } from '@/src/lib/sites/redirects'
import {
  canonicalUrlOf,
  fallbackFavicon,
  SITE_OG_IMAGE_SIZE,
  serializeJsonLd,
  siteJsonLd,
  socialImageOf,
} from '@/src/lib/sites/seo'
import {
  findSnapshotPage,
  globalOf,
  pageTitle,
  publicPathOf,
  type SiteSnapshot,
} from '@/src/lib/sites/snapshot'
import { SITE_CHROME_CSS } from '../../../_components/site-chrome-css'
import { SiteRuntime } from '../../../_components/site-runtime'
import {
  loadPublishedSite,
  loadSiteForms,
  loadSiteRedirects,
} from '../../../_lib/load'

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
    return {
      title: 'Página não encontrada',
      robots: { index: false },
      manifest: null,
    }
  }

  const { settings } = site.snapshot
  const canonical = canonicalUrlOf(site.snapshot, page, site.baseUrl)
  const title = pageTitle(site.snapshot, page)
  const description = page.seo.description || settings.seo.description
  const image = socialImageOf(site.snapshot, page, site.baseUrl)
  const images = [
    image.generated
      ? { url: image.url, ...SITE_OG_IMAGE_SIZE, alt: title }
      : { url: image.url },
  ]
  const noindex = Boolean(settings.seo.noindex || page.seo.noindex)
  const { colors } = parseSiteTheme(site.snapshot.theme)

  return {
    metadataBase: new URL(site.baseUrl),
    title: { absolute: title },
    description,
    applicationName: site.snapshot.name,
    alternates: { canonical },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    // Always the site's own icon (or its initial): never Steel's.
    icons: {
      icon:
        settings.faviconUrl ??
        fallbackFavicon(site.snapshot.name, colors.primary),
      ...(settings.faviconUrl ? { apple: settings.faviconUrl } : {}),
    },
    manifest: null,
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: site.snapshot.name,
      url: canonical,
      title,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image.url],
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

/** Reusable components (SYMBOL globals) the documents show, by id. */
function symbolsOf(
  snapshot: SiteSnapshot,
  docs: CanvasDocument[],
): Record<string, CanvasDocument> {
  const used = new Set(usedSymbolIds(docs))
  const symbols: Record<string, CanvasDocument> = {}
  for (const global of snapshot.globals) {
    if (global.kind === 'SYMBOL' && used.has(global.id)) {
      symbols[global.id] = global.document
    }
  }
  return symbols
}

export default async function PublishedSitePage({ params }: PageProps) {
  const { siteSlug, path = [] } = await params
  const [site, redirects, requestHeaders] = await Promise.all([
    loadPublishedSite(siteSlug),
    loadSiteRedirects(siteSlug),
    headers(),
  ])
  if (!site) notFound()
  const linkBase = siteLinkBase(
    site.slug,
    requestHeaders.get(SITE_VIA_HOST_HEADER) === '1',
  )

  // Redirects run before the page lookup: an old address keeps working
  // even when a page took its place.
  const moved = matchRedirect(redirects, `/${path.join('/')}`)
  if (moved) {
    const location = resolveSiteHref(moved.location, linkBase)
    if (moved.permanent) permanentRedirect(location)
    redirect(location)
  }

  const page = findSnapshotPage(site.snapshot, path)
  if (!page) notFound()

  const { snapshot } = site
  const header = asChrome(globalOf(snapshot, 'HEADER')?.document)
  const footer = asChrome(globalOf(snapshot, 'FOOTER')?.document)
  const shown = [header, page.document, footer].filter(
    (doc) => doc !== undefined,
  )
  const symbols = symbolsOf(snapshot, shown)
  const documents = [...shown, ...Object.values(symbols)]
  const forms = await loadSiteForms(
    site.slug,
    site.workspaceId,
    collectFormTokens(documents),
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
    symbols,
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
      {/* The site's own CSP (hoisted to <head>): only the trackers this
          site configured, on top of the proxy's header policy. */}
      <meta
        httpEquiv='Content-Security-Policy'
        content={siteMetaCsp(snapshot.settings.tracking, {
          nonce,
          development: NODE_ENV === 'development',
        })}
      />
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
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(siteJsonLd(snapshot, page, site.baseUrl)),
        }}
      />
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
      <SiteRuntime
        slug={site.slug}
        pageId={page.id}
        path={`/${publicPathOf(snapshot, page)}`}
        settings={snapshot.settings}
        linkBase={linkBase}
        nonce={nonce}
      />
    </>
  )
}
