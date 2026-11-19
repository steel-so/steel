import { SiteSeoService } from '@/src/services/site-seo.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Sends the published URLs to IndexNow now (outside a publish). */
export const POST = siteRoute<Params>(
  { consent: '/api/workspaces/[id]/crm/sites/[siteId]/search/reindex' },
  ({ userId, params }) =>
    SiteSeoService.reindex(userId, params.id, params.siteId),
)
