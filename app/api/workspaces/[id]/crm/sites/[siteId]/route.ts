import { type UpdateSiteDTO, UpdateSiteSchema } from '@/src/schemas/site.schema'
import { SiteService } from '@/src/services/site.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string; siteId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteService.get(userId, params.id, params.siteId),
)

export const PATCH = siteRoute<Params, UpdateSiteDTO>(
  { consent: ROUTE, body: UpdateSiteSchema },
  ({ userId, params, body }) =>
    SiteService.update(userId, params.id, params.siteId, body),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) => SiteService.remove(userId, params.id, params.siteId),
)
