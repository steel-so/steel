import {
  type CreateSitePageDTO,
  CreateSitePageSchema,
} from '@/src/schemas/site-page.schema'
import { SitePageService } from '@/src/services/site-page.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

/** Pages in menu order, without their documents. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SitePageService.list(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSitePageDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/pages',
    body: CreateSitePageSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SitePageService.create(userId, params.id, params.siteId, body),
)
