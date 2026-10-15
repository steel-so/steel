import {
  type UpdateSiteCollectionDTO,
  UpdateSiteCollectionSchema,
} from '@/src/schemas/site-collection.schema'
import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string; collectionId: string }

const ROUTE =
  '/api/workspaces/[id]/crm/sites/[siteId]/collections/[collectionId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteCollectionService.get(
    userId,
    params.id,
    params.siteId,
    params.collectionId,
  ),
)

export const PATCH = siteRoute<Params, UpdateSiteCollectionDTO>(
  { consent: ROUTE, body: UpdateSiteCollectionSchema },
  ({ userId, params, body }) =>
    SiteCollectionService.update(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteCollectionService.remove(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
    ),
)
