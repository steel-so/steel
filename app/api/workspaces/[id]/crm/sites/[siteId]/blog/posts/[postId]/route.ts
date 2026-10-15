import {
  type UpdateSitePostDTO,
  UpdateSitePostSchema,
} from '@/src/schemas/site-blog.schema'
import { SitePostService } from '@/src/services/site-post.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; postId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/blog/posts/[postId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SitePostService.get(userId, params.id, params.siteId, params.postId),
)

export const PATCH = siteRoute<Params, UpdateSitePostDTO>(
  { consent: ROUTE, body: UpdateSitePostSchema },
  ({ userId, params, body }) =>
    SitePostService.update(
      userId,
      params.id,
      params.siteId,
      params.postId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SitePostService.remove(userId, params.id, params.siteId, params.postId),
)
