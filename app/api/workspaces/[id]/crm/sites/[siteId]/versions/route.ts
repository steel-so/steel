import { SiteService } from '@/src/services/site.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteService.listVersions(userId, params.id, params.siteId),
)
