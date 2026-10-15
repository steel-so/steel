import { SiteSearchService } from '@/src/services/site-search.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** "Saúde nos buscadores": SEO, AEO and GEO scores of every draft page. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteSearchService.report(userId, params.id, params.siteId),
)
