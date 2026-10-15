import {
  type CreateSiteBlogCategoryDTO,
  CreateSiteBlogCategorySchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogTaxonomyService } from '@/src/services/site-blog-taxonomy.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteBlogTaxonomyService.listCategories(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteBlogCategoryDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/categories',
    body: CreateSiteBlogCategorySchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteBlogTaxonomyService.createCategory(
      userId,
      params.id,
      params.siteId,
      body,
    ),
)
