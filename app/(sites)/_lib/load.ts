import { cacheLife, cacheTag } from 'next/cache'
import type { SiteLiveForm } from '@/src/lib/canvas-site'
import { siteCacheTag } from '@/src/lib/sites/cache'
import type { RuntimeExperiment } from '@/src/lib/sites/experiments'
import type { SiteRedirectRule } from '@/src/lib/sites/redirects'
import type { SiteLiveNewsletter } from '@/src/schemas/crm-newsletter-archive.schema'
import { CrmNewsletterArchiveService } from '@/src/services/crm-newsletter-archive.service'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import {
  type PublishedSite,
  SitePublicService,
} from '@/src/services/site-public.service'
import { SiteRedirectService } from '@/src/services/site-redirect.service'

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

/** Redirect rules of a site (live as soon as saved: every change expires
 * the site's tag). */
export async function loadSiteRedirects(
  slug: string,
): Promise<SiteRedirectRule[]> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('days')
  const result = await SiteRedirectService.rulesForSlug(slug)
  return result.ok ? result.value : []
}

/** Running A/B tests of a site (start, pause, stop and edits expire the
 * site's tag; the schedule is checked per request). */
export async function loadSiteExperiments(
  slug: string,
): Promise<RuntimeExperiment[]> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('days')
  const result = await SiteExperimentService.runningForSlug(slug)
  return result.ok ? result.value : []
}

/** CRM newsletters of `site.newsletter-*` blocks (subscribe form and
 * latest issues); short life, since a newly sent issue does not expire the
 * site's tag. */
export async function loadSiteNewsletters(
  slug: string,
  workspaceId: string,
  newsletterIds: string[],
): Promise<Record<string, SiteLiveNewsletter>> {
  'use cache'
  cacheTag(siteCacheTag(slug))
  cacheLife('minutes')
  const result = await CrmNewsletterArchiveService.siteNewsletters(
    workspaceId,
    newsletterIds,
  )
  return result.ok ? result.value : {}
}
