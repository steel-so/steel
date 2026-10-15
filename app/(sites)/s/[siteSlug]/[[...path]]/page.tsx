import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { NODE_ENV } from '@/lib/env/env'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  compileSiteCss,
  parseSiteTheme,
  SiteDocument,
  type SiteRenderContext,
  siteRuntimeScripts,
  usedSymbolIds,
} from '@/src/lib/canvas-site'
import { withGraphNodes } from '@/src/lib/sites/blog/jsonld'
import {
  BLOG_PAGE_PARAM,
  BLOG_SEARCH_PARAM,
  pageNumber,
  searchTerm,
} from '@/src/lib/sites/blog/routes'
import { siteMetaCsp } from '@/src/lib/sites/csp'
import { collectFormTokens } from '@/src/lib/sites/document'
import {
  AB_CONFIG_ID,
  abCookieName,
  abRuntimeConfig,
  resolveAbVisitorKey,
  SITE_AB_SCRIPT,
  serializeAbConfig,
} from '@/src/lib/sites/experiment-runtime'
import { planExperiments } from '@/src/lib/sites/experiments'
import {
  resolveSiteHref,
  SITE_VIA_HOST_HEADER,
  siteLinkBase,
} from '@/src/lib/sites/host'
import { matchRedirect } from '@/src/lib/sites/redirects'
import { searchSettingsOf } from '@/src/lib/sites/search/context'
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
import { clientIp } from '@/src/lib/sites/visitor'
import { DEFAULT_SITE_TIMEZONE } from '@/src/schemas/site.schema'
import { parseSearchContent } from '@/src/schemas/site-search.schema'
import { SITE_CHROME_CSS } from '../../../_components/site-chrome-css'
import { SiteRuntime } from '../../../_components/site-runtime'
import {
  type DynamicPage,
  type DynamicRequest,
  resolveDynamicPage,
  siteCmsContext,
} from '../../../_lib/cms'
import {
  loadPublishedSite,
  loadSiteExperiments,
  loadSiteForms,
  loadSiteRedirects,
} from '../../../_lib/load'

type PageProps = {
  params: Promise<{ siteSlug: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Page number and search term of a blog page (`?pagina=`, `?busca=`). */
async function dynamicRequest(
  searchParams: PageProps['searchParams'],
): Promise<DynamicRequest> {
  const query = await searchParams
  return {
    page: pageNumber(query[BLOG_PAGE_PARAM]),
    query: searchTerm(query[BLOG_SEARCH_PARAM]),
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { siteSlug, path = [] } = await params
  const site = await loadPublishedSite(siteSlug)
  // Blog posts, archives and collection items (slice site-blog).
  const dynamic =
    site && !findSnapshotPage(site.snapshot, path)
      ? await resolveDynamicPage(site, path, await dynamicRequest(searchParams))
      : null
  const page = site
    ? (findSnapshotPage(site.snapshot, path) ?? dynamic?.page ?? null)
    : null
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
  // Ownership checks of Google Search Console and Bing Webmaster Tools.
  const { verification } = searchSettingsOf(settings)

  return {
    metadataBase: new URL(site.baseUrl),
    title: { absolute: title },
    description,
    applicationName: site.snapshot.name,
    alternates: {
      canonical,
      ...(dynamic?.route
        ? {
            types: {
              'application/rss+xml': `${site.baseUrl}/feed.xml`,
              'application/atom+xml': `${site.baseUrl}/atom.xml`,
            },
          }
        : {}),
    },
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
    ...(verification.google || verification.bing
      ? {
          verification: {
            ...(verification.google ? { google: verification.google } : {}),
            ...(verification.bing
              ? { other: { 'msvalidate.01': verification.bing } }
              : {}),
          },
        }
      : {}),
    openGraph: {
      ...(dynamic?.post
        ? {
            type: 'article' as const,
            publishedTime: dynamic.post.publishedAt,
            modifiedTime: dynamic.post.updatedAt,
          }
        : { type: 'website' as const }),
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

export default async function PublishedSitePage({
  params,
  searchParams,
}: PageProps) {
  const { siteSlug, path = [] } = await params
  const [site, redirects, experiments, requestHeaders, cookieStore] =
    await Promise.all([
      loadPublishedSite(siteSlug),
      loadSiteRedirects(siteSlug),
      loadSiteExperiments(siteSlug),
      headers(),
      cookies(),
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

  const request = await dynamicRequest(searchParams)
  // Regular pages win; then the blog and collection item pages.
  let dynamic: DynamicPage | null = null
  let page = findSnapshotPage(site.snapshot, path)
  if (!page) {
    dynamic = await resolveDynamicPage(site, path, request)
    page = dynamic?.page ?? null
  }
  if (!page) notFound()

  const { snapshot } = site
  // A/B tests: the variant of each running test is picked on the server
  // (no flicker) from the visitor's key — the consented cookie, else the
  // anonymous daily hash. See `src/lib/sites/experiments.ts`.
  const now = new Date()
  const visitorKey = resolveAbVisitorKey({
    cookie: cookieStore.get(abCookieName(site.slug))?.value,
    ip: clientIp(requestHeaders.get('x-forwarded-for')),
    userAgent: requestHeaders.get('user-agent') ?? '',
    siteId: site.id,
    secret: BETTER_AUTH_SECRET,
    now,
  })
  const plan = planExperiments({
    snapshot,
    page,
    experiments,
    visitorKey,
    now,
  })
  const chromeOf = (kind: 'HEADER' | 'FOOTER') => {
    const doc = asChrome(globalOf(snapshot, kind)?.document)
    return doc ? plan.chrome(doc) : undefined
  }
  const header = chromeOf('HEADER')
  const footer = chromeOf('FOOTER')
  const pageDocument = plan.document
  const abEntries = plan.entries()
  const shown = [header, pageDocument, footer].filter(
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
    cms: await siteCmsContext(site, documents, {
      path: `/${publicPathOf(snapshot, page)}`,
      dynamic,
      request,
      linkBase,
    }),
  }
  // "Atualizado em …" (Buscadores → freshness), in the site's timezone.
  const updatedLabel =
    page.updatedAt && parseSearchContent(page.seo.search).showUpdatedDate
      ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'long',
          timeZone: snapshot.settings.timezone ?? DEFAULT_SITE_TIMEZONE,
        }).format(new Date(page.updatedAt))}`
      : null
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
          __html: serializeJsonLd(
            withGraphNodes(
              siteJsonLd(snapshot, page, site.baseUrl),
              dynamic?.jsonLd ?? [],
            ),
          ),
        }}
      />
      {header ? <SiteDocument doc={header} context={context} /> : null}
      <SiteDocument doc={pageDocument} context={context} />
      {updatedLabel && page.updatedAt ? (
        <p className='ss-updated'>
          <time dateTime={page.updatedAt}>{updatedLabel}</time>
        </p>
      ) : null}
      {footer ? <SiteDocument doc={footer} context={context} /> : null}
      {runtime.scripts.map((script) => (
        <script
          key={script.id}
          nonce={nonce}
          data-site-runtime={script.id}
          dangerouslySetInnerHTML={{ __html: script.code }}
        />
      ))}
      {abEntries.length > 0 ? (
        <>
          <script
            id={AB_CONFIG_ID}
            type='application/json'
            dangerouslySetInnerHTML={{
              __html: serializeAbConfig(
                abRuntimeConfig({
                  slug: site.slug,
                  visitorKey,
                  bannerEnabled: snapshot.settings.cookieBanner.enabled,
                  entries: abEntries,
                }),
              ),
            }}
          />
          <script
            nonce={nonce}
            data-site-runtime='ab'
            dangerouslySetInnerHTML={{ __html: SITE_AB_SCRIPT }}
          />
        </>
      ) : null}
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
