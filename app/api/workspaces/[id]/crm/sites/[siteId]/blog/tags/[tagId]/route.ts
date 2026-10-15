import {
  type UpdateSiteBlogTagDTO,
  UpdateSiteBlogTagSchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogTaxonomyService } from '@/src/services/site-blog-taxonomy.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; tagId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/blog/tags/[tagId]'

export const PATCH = siteRoute<Params, UpdateSiteBlogTagDTO>(
  { consent: ROUTE, body: UpdateSiteBlogTagSchema },
  ({ userId, params, body }) =>
    SiteBlogTaxonomyService.updateTag(
      userId,
      params.id,
      params.siteId,
      params.tagId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteBlogTaxonomyService.removeTag(
      userId,
      params.id,
      params.siteId,
      params.tagId,
    ),
)
