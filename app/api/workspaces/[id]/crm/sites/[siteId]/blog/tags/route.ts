import {
  type CreateSiteBlogTagDTO,
  CreateSiteBlogTagSchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogTaxonomyService } from '@/src/services/site-blog-taxonomy.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteBlogTaxonomyService.listTags(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteBlogTagDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/tags',
    body: CreateSiteBlogTagSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteBlogTaxonomyService.createTag(userId, params.id, params.siteId, body),
)
