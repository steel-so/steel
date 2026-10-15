import {
  type CreateSiteRedirectDTO,
  CreateSiteRedirectSchema,
} from '@/src/schemas/site-redirect.schema'
import { SiteRedirectService } from '@/src/services/site-redirect.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteRedirectService.list(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteRedirectDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/redirects',
    body: CreateSiteRedirectSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteRedirectService.create(userId, params.id, params.siteId, body),
)
