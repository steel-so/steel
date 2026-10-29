import { revalidateTag } from 'next/cache'
import { logger } from '@/lib/axiom/logger'

/**
 * Cache tags of the public newsletter archive (`/n/<ws>/<newsletter>`, the
 * issue pages and `rss.xml`). Every cached read of a newsletter is tagged
 * with `newsletter-archive:<ws>/<newsletter>`.
 *
 * Who expires it: the issues slice when an issue reaches SENT (and when a
 * sent issue is removed), and the newsletter slice when the newsletter is
 * edited, archived/reactivated, renamed (call it with the OLD and the new
 * slug) or has the archive switched off.
 */
export function newsletterArchiveTag(
  workspaceSlug: string,
  newsletterSlug: string,
): string {
  return `newsletter-archive:${workspaceSlug}/${newsletterSlug}`
}

/**
 * Expires the archive of one newsletter now (no stale window: an issue
 * just sent must show on the next visit). Outside a Next request (the
 * worker, scripts) there is no cache to expire, so a failure is only
 * logged — callers never need to handle it.
 */
export function revalidateNewsletterArchive(
  workspaceSlug: string,
  newsletterSlug: string,
): void {
  try {
    revalidateTag(newsletterArchiveTag(workspaceSlug, newsletterSlug), {
      expire: 0,
    })
  } catch (error) {
    logger.warn('crm.newsletter.archive.revalidate_skipped', {
      workspaceSlug,
      newsletterSlug,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}
