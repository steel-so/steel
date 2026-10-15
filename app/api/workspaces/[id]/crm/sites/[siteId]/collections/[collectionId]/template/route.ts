import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; collectionId: string }

/** Creates the item page template (or returns the existing one). */
export const POST = siteRoute<Params>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/collections/[collectionId]/template',
  },
  ({ userId, params }) =>
    SiteCollectionService.ensureItemTemplate(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
    ),
)
