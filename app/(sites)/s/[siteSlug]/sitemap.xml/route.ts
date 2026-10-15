import { sitePageUrl } from '@/src/lib/sites/host'
import {
  indexablePages,
  publicPathOf,
  renderSitemapXml,
} from '@/src/lib/sites/snapshot'
import { SiteBlogPublicService } from '@/src/services/site-blog-public.service'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site) return new Response('Not found', { status: 404 })

  const lastModified = new Date(site.publishedAt)
  // Blog posts and collection items with a page (slice site-blog).
  const dynamic = site.snapshot.settings.seo.noindex
    ? null
    : await SiteBlogPublicService.sitemap(site.id, site.snapshot, new Date())
  const dynamicUrls = dynamic?.ok
    ? dynamic.value.map((entry) => ({
        loc: sitePageUrl(site.baseUrl, entry.path.slice(1)),
        lastModified: entry.lastModified,
      }))
    : []
  const xml = renderSitemapXml([
    ...indexablePages(site.snapshot)
      .map((page) => ({
        page,
        loc: sitePageUrl(site.baseUrl, publicPathOf(site.snapshot, page)),
      }))
      // A page whose canonical lives elsewhere is not listed.
      .filter(
        ({ page, loc }) =>
          !page.seo.canonicalUrl || page.seo.canonicalUrl === loc,
      )
      .map(({ page, loc }) => ({
        loc,
        // The page's own last edit when the snapshot has it.
        lastModified: page.updatedAt ? new Date(page.updatedAt) : lastModified,
        priority: page.seo.sitemapPriority,
        changeFrequency: page.seo.changeFrequency,
      })),
    ...dynamicUrls,
  ])
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
