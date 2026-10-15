import {
  type SearchAiOptimizeDTO,
  SearchAiOptimizeSchema,
} from '@/src/schemas/site-search.schema'
import { SiteSearchAiService } from '@/src/services/site-search-ai.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string }

/** "Otimizar com IA": suggestions for review (nothing is saved here). */
export const POST = siteRoute<Params, SearchAiOptimizeDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/search/ai/optimize',
    body: SearchAiOptimizeSchema,
  },
  ({ userId, params, body }) =>
    SiteSearchAiService.optimize(userId, params.id, params.siteId, body),
)
