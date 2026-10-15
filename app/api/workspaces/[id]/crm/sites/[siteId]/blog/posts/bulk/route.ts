import {
  type BulkSitePostsDTO,
  BulkSitePostsSchema,
} from '@/src/schemas/site-blog.schema'
import { SitePostService } from '@/src/services/site-post.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string }

export const POST = siteRoute<Params, BulkSitePostsDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/posts/bulk',
    body: BulkSitePostsSchema,
  },
  ({ userId, params, body }) =>
    SitePostService.bulk(userId, params.id, params.siteId, body),
)
