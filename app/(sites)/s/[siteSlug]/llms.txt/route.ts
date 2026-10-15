import { withLlmsSections } from '@/src/lib/sites/blog/llms'
import { llmsEnabled, renderLlmsTxt } from '@/src/lib/sites/search/llms'
import { SiteBlogPublicService } from '@/src/services/site-blog-public.service'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/** `/llms.txt` (llmstxt.org): the site summarized for AI assistants, with
 * the blog posts and collection items (slice site-blog). */
export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  if (!site || !llmsEnabled(site.snapshot)) {
    return new Response('Not found', { status: 404 })
  }
  const sections = await SiteBlogPublicService.llmsSections(
    site.id,
    site.snapshot,
    site.baseUrl,
    new Date(),
  )
  const body = renderLlmsTxt(site.snapshot, site.baseUrl)
  return new Response(
    sections.ok ? withLlmsSections(body, sections.value) : body,
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  )
}
