import { cacheLife, cacheTag } from 'next/cache'
import type { SiteLiveForm } from '@/src/lib/canvas-site'
import { siteCacheTag } from '@/src/lib/sites/cache'
import {
  type PublishedSite,
  SitePublicService,
} from '@/src/services/site-public.service'

/**
 * Cached reads of the public runtime, tagged `site:<slug>`: publishing,
 * unpublishing, renaming or deleting a site expires them (see
 * `revalidateSites`). A miss is cached too, so a probe for an unknown slug
 * does not hit the database every time; publishing expires it.
 */

export async function loadPublishedSite(
  slug: string,
): Promise<PublishedSite | null> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('days')
  const result = await SitePublicService.getPublished(slug)
  return result.ok ? result.value : null
}

/** CRM forms of `site.form` blocks; shorter life, since forms are edited
 * outside the site and do not expire its tag. */
export async function loadSiteForms(
  slug: string,
  workspaceId: string,
  formTokens: string[],
): Promise<Record<string, SiteLiveForm>> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await SitePublicService.getForms(workspaceId, formTokens)
  return result.ok ? result.value : {}
}
