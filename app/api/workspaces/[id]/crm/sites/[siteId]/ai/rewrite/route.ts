import {
  type RewriteSitePageDTO,
  RewriteSitePageSchema,
} from '@/src/schemas/site-ai.schema'
import { SiteAiService } from '@/src/services/site-ai.service'
import { siteAiRoute } from '../../../_lib/ai-handler'

type Params = { id: string; siteId: string }

/** Rewrites the copy of the page in the editor (returns update changes). */
export const POST = siteAiRoute<Params, RewriteSitePageDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/ai/rewrite',
    body: RewriteSitePageSchema,
  },
  ({ userId, params, body }) =>
    SiteAiService.rewritePage(userId, params.id, params.siteId, body),
)
