import { searchSettingsOf } from '@/src/lib/sites/search/context'
import { loadPublishedSite } from '../../../_lib/load'

type Params = { params: Promise<{ siteSlug: string }> }

/** IndexNow key file: proves to the engines that the pings are ours. */
export async function GET(_request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  const site = await loadPublishedSite(siteSlug)
  const indexNow = site
    ? searchSettingsOf(site.snapshot.settings).indexNow
    : null
  if (!indexNow?.enabled || !indexNow.key) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(indexNow.key, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
