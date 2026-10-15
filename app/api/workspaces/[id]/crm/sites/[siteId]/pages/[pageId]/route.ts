import {
  type UpdateSitePageDTO,
  UpdateSitePageSchema,
} from '@/src/schemas/site-page.schema'
import { SitePageService } from '@/src/services/site-page.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string; pageId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/pages/[pageId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SitePageService.get(userId, params.id, params.siteId, params.pageId),
)

export const PATCH = siteRoute<Params, UpdateSitePageDTO>(
  { consent: ROUTE, body: UpdateSitePageSchema },
  ({ userId, params, body }) =>
    SitePageService.update(
      userId,
      params.id,
      params.siteId,
      params.pageId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SitePageService.remove(userId, params.id, params.siteId, params.pageId),
)
