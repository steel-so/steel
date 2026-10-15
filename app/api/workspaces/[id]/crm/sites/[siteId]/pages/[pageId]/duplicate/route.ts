import {
  type DuplicateSitePageDTO,
  DuplicateSitePageSchema,
} from '@/src/schemas/site-page.schema'
import { SitePageService } from '@/src/services/site-page.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; pageId: string }

export const POST = siteRoute<Params, DuplicateSitePageDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/pages/[pageId]/duplicate',
    body: DuplicateSitePageSchema,
    allowEmptyBody: true,
    status: 201,
  },
  ({ userId, params, body }) =>
    SitePageService.duplicate(
      userId,
      params.id,
      params.siteId,
      params.pageId,
      body,
    ),
)
