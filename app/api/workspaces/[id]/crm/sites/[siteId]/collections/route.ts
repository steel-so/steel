import {
  type CreateSiteCollectionDTO,
  CreateSiteCollectionSchema,
} from '@/src/schemas/site-collection.schema'
import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteCollectionService.list(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteCollectionDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/collections',
    body: CreateSiteCollectionSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteCollectionService.create(userId, params.id, params.siteId, body),
)
