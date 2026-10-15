import {
  type ReorderSitePagesDTO,
  ReorderSitePagesSchema,
} from '@/src/schemas/site-page.schema'
import { SitePageService } from '@/src/services/site-page.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

export const PATCH = siteRoute<Params, ReorderSitePagesDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/pages/reorder',
    body: ReorderSitePagesSchema,
  },
  ({ userId, params, body }) =>
    SitePageService.reorder(userId, params.id, params.siteId, body.orderedIds),
)
