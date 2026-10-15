import {
  type DuplicateSiteDTO,
  DuplicateSiteSchema,
} from '@/src/schemas/site-studio.schema'
import { SiteStudioService } from '@/src/services/site-studio.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

/** Draft copy of a site with its pages and globals. */
export const POST = siteRoute<Params, DuplicateSiteDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/duplicate',
    body: DuplicateSiteSchema,
    allowEmptyBody: true,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteStudioService.duplicate(userId, params.id, params.siteId, body),
)
