import { type CreateSiteDTO, CreateSiteSchema } from '@/src/schemas/site.schema'
import { SiteService } from '@/src/services/site.service'
import { siteRoute } from './_lib/handler'

type Params = { id: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteService.list(userId, params.id),
)

export const POST = siteRoute<Params, CreateSiteDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites',
    body: CreateSiteSchema,
    status: 201,
  },
  ({ userId, params, body }) => SiteService.create(userId, params.id, body),
)
