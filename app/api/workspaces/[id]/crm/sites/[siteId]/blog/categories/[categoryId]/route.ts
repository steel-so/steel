import {
  type UpdateSiteBlogCategoryDTO,
  UpdateSiteBlogCategorySchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogTaxonomyService } from '@/src/services/site-blog-taxonomy.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; categoryId: string }

const ROUTE =
  '/api/workspaces/[id]/crm/sites/[siteId]/blog/categories/[categoryId]'

export const PATCH = siteRoute<Params, UpdateSiteBlogCategoryDTO>(
  { consent: ROUTE, body: UpdateSiteBlogCategorySchema },
  ({ userId, params, body }) =>
    SiteBlogTaxonomyService.updateCategory(
      userId,
      params.id,
      params.siteId,
      params.categoryId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteBlogTaxonomyService.removeCategory(
      userId,
      params.id,
      params.siteId,
      params.categoryId,
    ),
)
