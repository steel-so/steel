import { siteFeedResponse } from '../../../_lib/feed'

type Params = { params: Promise<{ siteSlug: string }> }

export async function GET(request: Request, ctx: Params) {
  const { siteSlug } = await ctx.params
  return siteFeedResponse(request, siteSlug, 'rss')
}
