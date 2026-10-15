import { llmsEnabled, renderLlmsTxt } from '@/src/lib/sites/search/llms'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/** `/llms.txt` (llmstxt.org): the site summarized for AI assistants. */
export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site || !llmsEnabled(site.snapshot)) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(renderLlmsTxt(site.snapshot, site.baseUrl), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
