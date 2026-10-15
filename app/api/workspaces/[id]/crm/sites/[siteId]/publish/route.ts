import { SiteService } from '@/src/services/site.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/publish'

/** Snapshots the draft into a new version and makes it live. */
export const POST = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) => SiteService.publish(userId, params.id, params.siteId),
)

/** Takes the site offline (the versions stay). */
export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteService.unpublish(userId, params.id, params.siteId),
)
