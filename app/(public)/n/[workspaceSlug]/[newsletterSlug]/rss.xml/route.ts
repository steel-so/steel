import { BETTER_AUTH_URL } from '@/lib/env/server'
import { renderNewsletterRss } from '@/src/lib/newsletter/rss'
import { loadNewsletterFeed } from '../_lib/load'

type Params = {
  params: Promise<{ workspaceSlug: string; newsletterSlug: string }>
}

/**
 * RSS 2.0 of a newsletter's public archive: the last 50 SENT issues with
 * absolute links to their web versions. Same 404 rules as the archive.
 */
export async function GET(_request: Request, ctx: Params) {
  const { workspaceSlug, newsletterSlug } = await ctx.params
  const feed = await loadNewsletterFeed(workspaceSlug, newsletterSlug)
  if (!feed) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return new Response(renderNewsletterRss(feed, BETTER_AUTH_URL), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
