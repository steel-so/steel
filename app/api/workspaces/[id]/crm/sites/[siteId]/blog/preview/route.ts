import { SiteBlogService } from '@/src/services/site-blog.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Data the editor canvas renders the blog/collection elements with. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteBlogService.preview(userId, params.id, params.siteId),
)
