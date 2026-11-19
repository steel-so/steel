import { SiteSeoService } from '@/src/services/site-seo.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** CRM > SEO detail of a site: checklist, keywords and 90 days of history. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteSeoService.detail(userId, params.id, params.siteId),
)
