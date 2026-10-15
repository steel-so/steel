import { revalidateTag } from 'next/cache'
import { logger } from '@/lib/axiom/logger'

/**
 * Cache tags of the public runtime. Every cached read of a published site is
 * tagged with `site:<slug>`; publishing, unpublishing, renaming or deleting
 * the site expires the tag so the next visit renders the new snapshot.
 */
export function siteCacheTag(slug: string): string {
  return `site:${slug}`
}

/** Expires the cache of each slug now (no stale window: a publish must show
 * on the next visit). Outside a Next request (scripts, the worker) there is
 * no cache to expire, so a failure is only logged. */
export function revalidateSites(...slugs: string[]): void {
  for (const slug of new Set(slugs)) {
    try {
      revalidateTag(siteCacheTag(slug), { expire: 0 })
    } catch (error) {
      logger.warn('sites.cache.revalidate_skipped', {
        slug,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
