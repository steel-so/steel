import { llmsEnabled, renderLlmsFullTxt } from '@/src/lib/sites/search/llms'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/** `/llms-full.txt`: the text of every indexable page, in Markdown. */
export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site || !llmsEnabled(site.snapshot)) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(renderLlmsFullTxt(site.snapshot, site.baseUrl), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
