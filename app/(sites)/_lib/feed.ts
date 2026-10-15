import {
  FEED_LIMIT,
  type FeedChannel,
  renderAtom,
  renderRss,
} from '@/src/lib/sites/blog/feeds'
import { excerptOf } from '@/src/lib/sites/blog/plate'
import { blogPath } from '@/src/lib/sites/blog/routes'
import { sitePageUrl } from '@/src/lib/sites/host'
import { absoluteUrl } from '@/src/lib/sites/seo'
import { SiteBlogPublicService } from '@/src/services/site-blog-public.service'
import { loadPublishedSite } from './load'

/**
 * RSS (`/feed.xml`) and Atom (`/atom.xml`) of a published site's blog;
 * `?categoria=<slug>` narrows them to one category. Read live (not
 * cached): feed readers poll rarely and must see a post right away.
 */
export async function siteFeedResponse(
  request: Request,
  siteSlug: string,
  format: 'rss' | 'atom',
): Promise<Response> {
  const site = await loadPublishedSite(siteSlug)
  if (!site) return new Response('Not found', { status: 404 })
  const categorySlug =
    new URL(request.url).searchParams.get('categoria')?.trim().toLowerCase() ||
    undefined
  const feed = await SiteBlogPublicService.feed(
    site.id,
    new Date(),
    FEED_LIMIT,
    categorySlug,
  )
  if (!feed.ok) return new Response('Unavailable', { status: 503 })
  if (!feed.value) return new Response('Not found', { status: 404 })

  const { settings } = site.snapshot
  const blogUrl = sitePageUrl(
    site.baseUrl,
    blogPath({ kind: 'index' }).slice(1),
  )
  const path = format === 'rss' ? 'feed.xml' : 'atom.xml'
  const query = categorySlug
    ? `?categoria=${encodeURIComponent(categorySlug)}`
    : ''
  const posts = feed.value.posts
  const channel: FeedChannel = {
    title: feed.value.category
      ? `${site.snapshot.name} — ${feed.value.category}`
      : site.snapshot.name,
    description: settings.seo.description || `Blog de ${site.snapshot.name}`,
    link: blogUrl,
    feedUrl: `${site.baseUrl}/${path}${query}`,
    updatedAt: (
      posts[0]?.updatedAt ?? new Date(site.publishedAt)
    ).toISOString(),
    entries: posts.map((post) => {
      const url = sitePageUrl(
        site.baseUrl,
        blogPath({ kind: 'post', slug: post.slug }).slice(1),
      )
      return {
        title: post.title,
        url,
        id: url,
        publishedAt: (post.publishedAt ?? post.createdAt).toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        summary: post.excerpt || excerptOf(post.plainText, 300),
        contentHtml: post.contentHtml,
        categories: post.categories.map((entry) => entry.category.name),
        author: post.author?.name ?? null,
        imageUrl: post.coverImageUrl
          ? absoluteUrl(post.coverImageUrl, site.baseUrl)
          : null,
      }
    }),
  }
  const body = format === 'rss' ? renderRss(channel) : renderAtom(channel)
  return new Response(body, {
    headers: {
      'Content-Type':
        format === 'rss'
          ? 'application/rss+xml; charset=utf-8'
          : 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
