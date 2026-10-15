import {
  type SearchAiSummaryDTO,
  SearchAiSummarySchema,
} from '@/src/schemas/site-search.schema'
import { SiteSearchAiService } from '@/src/services/site-search-ai.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string }

/** "Como a IA resumiria esta página" (CRM AI provider, monthly quota). */
export const POST = siteRoute<Params, SearchAiSummaryDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/search/ai/summary',
    body: SearchAiSummarySchema,
  },
  ({ userId, params, body }) =>
    SiteSearchAiService.summary(userId, params.id, params.siteId, body),
)
