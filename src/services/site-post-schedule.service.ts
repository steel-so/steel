import { siteRouteCache } from '@/src/cache/site-route.cache'
import { ok, type Result } from '@/src/lib/result'
import { SitePostRepository } from '@/src/repositories/site-post.repository'

/**
 * Scheduled blog posts (worker side). Kept apart from `SitePostService` so
 * the worker bundle does not pull Next's cache module: the runtime already
 * treats a due post as live, its cached lists expire within minutes, and
 * this tick expires the proxy's route index (Redis) so the new address
 * answers 200 at once.
 */

/** Scheduled posts published per worker tick. */
export const PUBLISH_BATCH = 500

export const SitePostScheduleService = {
  async publishDue(
    now: Date,
  ): Promise<Result<{ published: number; sites: number }>> {
    const due = await SitePostRepository.listDue(now, PUBLISH_BATCH)
    if (!due.ok) return due
    if (due.value.length === 0) return ok({ published: 0, sites: 0 })
    const published = await SitePostRepository.markPublished(
      due.value.map((post) => post.id),
    )
    if (!published.ok) return published
    const slugs = [...new Set(due.value.map((post) => post.site.slug))]
    await Promise.all(slugs.map((slug) => siteRouteCache.invalidate(slug)))
    return ok({ published: published.value, sites: slugs.length })
  },
}
