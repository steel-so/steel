import {
  type UpdateSiteSearchSettingsDTO,
  UpdateSiteSearchSettingsSchema,
} from '@/src/schemas/site-search.schema'
import { SiteSearchService } from '@/src/services/site-search.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

/** "Buscadores" settings of a site (business profile, crawlers, llms.txt,
 * IndexNow, verification). */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteSearchService.getSettings(userId, params.id, params.siteId),
)

export const PUT = siteRoute<Params, UpdateSiteSearchSettingsDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/search',
    body: UpdateSiteSearchSettingsSchema,
  },
  ({ userId, params, body }) =>
    SiteSearchService.updateSettings(userId, params.id, params.siteId, body),
)
