import {
  type UpdateSiteCollectionItemDTO,
  UpdateSiteCollectionItemSchema,
} from '@/src/schemas/site-collection.schema'
import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../../../../_lib/handler'

type Params = {
  id: string
  siteId: string
  collectionId: string
  itemId: string
}

const ROUTE =
  '/api/workspaces/[id]/crm/sites/[siteId]/collections/[collectionId]/items/[itemId]'

export const PATCH = siteRoute<Params, UpdateSiteCollectionItemDTO>(
  { consent: ROUTE, body: UpdateSiteCollectionItemSchema },
  ({ userId, params, body }) =>
    SiteCollectionService.updateItem(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
      params.itemId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteCollectionService.removeItem(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
      params.itemId,
    ),
)
