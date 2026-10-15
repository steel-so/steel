import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Running tests the next publish restarts (their variants changed). */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteExperimentService.impact(userId, params.id, params.siteId),
)
