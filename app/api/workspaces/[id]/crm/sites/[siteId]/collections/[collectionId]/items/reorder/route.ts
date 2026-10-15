import {
  type ReorderSiteCollectionItemsDTO,
  ReorderSiteCollectionItemsSchema,
} from '@/src/schemas/site-collection.schema'
import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../../../../_lib/handler'

type Params = { id: string; siteId: string; collectionId: string }

export const POST = siteRoute<Params, ReorderSiteCollectionItemsDTO>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/collections/[collectionId]/items/reorder',
    body: ReorderSiteCollectionItemsSchema,
  },
  ({ userId, params, body }) =>
    SiteCollectionService.reorderItems(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
      body,
    ),
)
