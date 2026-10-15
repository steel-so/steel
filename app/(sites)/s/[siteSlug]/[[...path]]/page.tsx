import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  compileSiteCss,
  createSiteCatalog,
  needsFormScript,
  parseSiteTheme,
  SITE_FORM_SCRIPT,
  SiteDocument,
  type SiteRenderContext,
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

export default async function PublishedSitePage({ params }: PageProps) {
  const { siteSlug, path = [] } = await params
  const site = await loadPublishedSite(siteSlug)
  if (!site) notFound()
  const page = findSnapshotPage(site.snapshot, path)
  if (!page) notFound()

  const { snapshot } = site
  const header = globalOf(snapshot, 'HEADER')
  const footer = globalOf(snapshot, 'FOOTER')
  const documents = [header?.document, page.document, footer?.document].filter(
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
    forms,
  }
  const catalog = createSiteCatalog(context)
  const css = compileSiteCss(documents, {
    theme: parseSiteTheme(snapshot.theme),
  })
  const nonce = requestHeaders.get('x-nonce') ?? undefined

  return (
    <>
      {/* Compiled stylesheet of the published site: theme tokens, classes
          and per-breakpoint media queries (no inline styles on elements). */}
      <style>{css}</style>
      <style>{SITE_CHROME_CSS}</style>
      {header ? <SiteDocument doc={header.document} catalog={catalog} /> : null}
      <main id='conteudo'>
        <SiteDocument doc={page.document} catalog={catalog} />
      </main>
      {footer ? <SiteDocument doc={footer.document} catalog={catalog} /> : null}
      {needsFormScript(documents) ? (
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: SITE_FORM_SCRIPT }}
        />
      ) : null}
      <SiteAnalytics
        slug={site.slug}
        pageId={page.id}
        path={`/${publicPathOf(snapshot, page)}`}
        banner={snapshot.settings.cookieBanner}
      />
    </>
  )
}
