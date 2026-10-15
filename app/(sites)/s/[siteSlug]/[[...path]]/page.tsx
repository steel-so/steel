import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { collectFormIds } from '@/src/lib/sites/document'
import {
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
import { siteStylesheet } from '../../../_components/site-catalog-adapter'
import { SiteDocument } from '../../../_components/site-document'
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

  const header = globalOf(site.snapshot, 'HEADER')
  const footer = globalOf(site.snapshot, 'FOOTER')
  const documents = [header?.document, page.document, footer?.document].filter(
    (doc) => doc !== undefined,
  )
  const forms = await loadSiteForms(
    site.slug,
    site.workspaceId,
    collectFormIds(documents),
  )
  const viaHost = (await headers()).get(SITE_VIA_HOST_HEADER) === '1'
  const ctx = {
    linkBase: siteLinkBase(site.slug, viaHost),
    pages: site.snapshot.pages,
    forms,
  }

  return (
    <div className='ss landing-page-light-scope' lang='pt-BR'>
      {/* Compiled stylesheet of the published site (classes, no inline
          styles on elements). */}
      <style>{siteStylesheet()}</style>
      <a className='sr-only focus:not-sr-only' href='#conteudo'>
        Pular para o conteúdo
      </a>
      {header ? (
        <header>
          <SiteDocument doc={header.document} ctx={ctx} />
        </header>
      ) : null}
      <main id='conteudo'>
        <SiteDocument doc={page.document} ctx={ctx} />
      </main>
      {footer ? (
        <footer>
          <SiteDocument doc={footer.document} ctx={ctx} />
        </footer>
      ) : null}
      <SiteAnalytics
        slug={site.slug}
        pageId={page.id}
        path={`/${publicPathOf(site.snapshot, page)}`}
        banner={site.snapshot.settings.cookieBanner}
      />
    </div>
  )
}
