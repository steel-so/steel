import { searchSettingsOf } from '@/src/lib/sites/search/context'
import { llmsEnabled } from '@/src/lib/sites/search/llms'
import { renderSearchRobotsTxt } from '@/src/lib/sites/search/robots'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/** `robots.txt` of a published site: the per-bot switches of
 * "Buscadores", the sitemap and the llms.txt hint. */
export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  const body = site
    ? renderSearchRobotsTxt({
        noindex: Boolean(site.snapshot.settings.seo.noindex),
        sitemapUrl: `${site.baseUrl}/sitemap.xml`,
        crawlers: searchSettingsOf(site.snapshot.settings).crawlers,
        llmsUrl: llmsEnabled(site.snapshot)
          ? `${site.baseUrl}/llms.txt`
          : undefined,
      })
    : renderSearchRobotsTxt({ noindex: true, sitemapUrl: '' })
  return new Response(body, {
    status: site ? 200 : 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
