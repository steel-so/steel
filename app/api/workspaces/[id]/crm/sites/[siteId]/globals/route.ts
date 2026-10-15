import {
  type CreateSiteGlobalDTO,
  CreateSiteGlobalSchema,
} from '@/src/schemas/site-global.schema'
import { SiteGlobalService } from '@/src/services/site-global.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteGlobalService.list(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteGlobalDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/globals',
    body: CreateSiteGlobalSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteGlobalService.create(userId, params.id, params.siteId, body),
)
