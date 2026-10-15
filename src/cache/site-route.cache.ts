import type { SiteRouteIndex } from '@/src/lib/sites/route-index'
import { createKeyedCache } from './_cache'

/** Route index of a published site by slug (proxy status decisions).
 * Expired by `revalidateSites` on publish, unpublish, rename, delete and
 * every redirect change; the TTL only bounds what nothing expired (the CRM
 * module being turned off). */
export const siteRouteCache = createKeyedCache<SiteRouteIndex>({
  prefix: 'site-routes:',
  ttl: 60 * 60,
  name: 'site_route',
})
