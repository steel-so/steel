import { SiteStudioService } from '@/src/services/site-studio.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

/** What the next publish changes on the live site. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteStudioService.pendingChanges(userId, params.id, params.siteId),
)
