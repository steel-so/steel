import {
  type UpdateSiteAuthorDTO,
  UpdateSiteAuthorSchema,
} from '@/src/schemas/site-blog.schema'
import { SiteBlogTaxonomyService } from '@/src/services/site-blog-taxonomy.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; authorId: string }

const ROUTE = '/api/workspaces/[id]/crm/sites/[siteId]/blog/authors/[authorId]'

export const PATCH = siteRoute<Params, UpdateSiteAuthorDTO>(
  { consent: ROUTE, body: UpdateSiteAuthorSchema },
  ({ userId, params, body }) =>
    SiteBlogTaxonomyService.updateAuthor(
      userId,
      params.id,
      params.siteId,
      params.authorId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteBlogTaxonomyService.removeAuthor(
      userId,
      params.id,
      params.siteId,
      params.authorId,
    ),
)
