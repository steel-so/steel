import {
  type SearchApplyDTO,
  SearchApplySchema,
} from '@/src/schemas/site-search.schema'
import { SiteSearchService } from '@/src/services/site-search.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Saves the AI suggestions the user reviewed and kept. */
export const POST = siteRoute<Params, SearchApplyDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/search/apply',
    body: SearchApplySchema,
  },
  ({ userId, params, body }) =>
    SiteSearchService.apply(userId, params.id, params.siteId, body),
)
