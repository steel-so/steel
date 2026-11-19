import { revalidateTag } from 'next/cache'
import { logger } from '@/lib/axiom/logger'

/** Cache tag of a published bio page (`/b/<slug>`). */
export function bioCacheTag(slug: string): string {
  return `bio:${slug}`
}

/** Expires the cached page of each slug now: an edit, a publish or an
 * unpublish shows on the next visit. Outside a Next request (scripts, the
 * worker) there is no cache to expire, so a failure is only logged. */
export function revalidateBioLinks(...slugs: string[]): void {
  for (const slug of new Set(slugs)) {
    try {
      revalidateTag(bioCacheTag(slug), { expire: 0 })
    } catch (error) {
      logger.warn('bio_link.cache.revalidate_skipped', {
        slug,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
