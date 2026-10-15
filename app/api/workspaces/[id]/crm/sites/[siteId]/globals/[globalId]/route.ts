import {
  type UpdateSiteGlobalDTO,
  UpdateSiteGlobalSchema,
} from '@/src/schemas/site-global.schema'
import { SiteGlobalService } from '@/src/services/site-global.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string; globalId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/globals/[globalId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteGlobalService.get(userId, params.id, params.siteId, params.globalId),
)

export const PATCH = siteRoute<Params, UpdateSiteGlobalDTO>(
  { consent: ROUTE, body: UpdateSiteGlobalSchema },
  ({ userId, params, body }) =>
    SiteGlobalService.update(
      userId,
      params.id,
      params.siteId,
      params.globalId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteGlobalService.remove(userId, params.id, params.siteId, params.globalId),
)
