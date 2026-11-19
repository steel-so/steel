import { SiteSeoService } from '@/src/services/site-seo.service'
import { siteRoute } from '../sites/_lib/handler'

type Params = { id: string }

/** CRM > SEO: scores, problems and history of every site of the workspace. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteSeoService.overview(userId, params.id),
)
