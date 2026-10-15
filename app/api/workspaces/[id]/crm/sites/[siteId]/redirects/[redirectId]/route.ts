import {
  type UpdateSiteRedirectDTO,
  UpdateSiteRedirectSchema,
} from '@/src/schemas/site-redirect.schema'
import { SiteRedirectService } from '@/src/services/site-redirect.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string; redirectId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/redirects/[redirectId]'

export const PATCH = siteRoute<Params, UpdateSiteRedirectDTO>(
  { consent: ROUTE, body: UpdateSiteRedirectSchema },
  ({ userId, params, body }) =>
    SiteRedirectService.update(
      userId,
      params.id,
      params.siteId,
      params.redirectId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteRedirectService.remove(
      userId,
      params.id,
      params.siteId,
      params.redirectId,
    ),
)
