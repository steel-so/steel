import {
  type SiteBlogAiDTO,
  SiteBlogAiSchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogAiService } from '@/src/services/site-blog-ai.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** AI draft for the post editor (write, summary, titles, FAQ). */
export const POST = siteRoute<Params, SiteBlogAiDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/ai',
    body: SiteBlogAiSchema,
  },
  ({ userId, params, body }) =>
    SiteBlogAiService.run(userId, params.id, params.siteId, body),
)
