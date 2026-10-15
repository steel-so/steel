import { BETTER_AUTH_URL, SITES_ROOT_DOMAIN } from '@/lib/env/server'
import { siteBaseUrl } from './host'

/** Public base URL of a site in this deployment (see `siteBaseUrl`). */
export function publicSiteUrl(slug: string): string {
  return siteBaseUrl(slug, {
    appUrl: BETTER_AUTH_URL,
    rootDomain: SITES_ROOT_DOMAIN,
  })
}
