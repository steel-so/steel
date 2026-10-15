import { sitePageUrl } from '@/src/lib/sites/host'
import {
  indexablePages,
  publicPathOf,
  renderSitemapXml,
} from '@/src/lib/sites/snapshot'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site) return new Response('Not found', { status: 404 })

  const lastModified = new Date(site.publishedAt)
  const xml = renderSitemapXml(
    indexablePages(site.snapshot).map((page) => ({
      loc: sitePageUrl(site.baseUrl, publicPathOf(site.snapshot, page)),
      lastModified,
    })),
  )
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
