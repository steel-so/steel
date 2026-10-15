import { SiteBlogService } from '@/src/services/site-blog.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Creates the missing blog templates (idempotent); returns all of them. */
export const POST = siteRoute<Params>(
  { consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/templates' },
  ({ userId, params }) =>
    SiteBlogService.ensureTemplates(userId, params.id, params.siteId),
)
