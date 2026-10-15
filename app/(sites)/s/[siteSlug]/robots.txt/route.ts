import { renderRobotsTxt } from '@/src/lib/sites/snapshot'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  const body = site
    ? renderRobotsTxt({
        noindex: Boolean(site.snapshot.settings.seo.noindex),
        sitemapUrl: `${site.baseUrl}/sitemap.xml`,
      })
    : renderRobotsTxt({ noindex: true, sitemapUrl: '' })
  return new Response(body, {
    status: site ? 200 : 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
