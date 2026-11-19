import { SiteSeoService } from '@/src/services/site-seo.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; keywordId: string }

/** Stops tracking a keyword. */
export const DELETE = siteRoute<Params>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/search/keywords/[keywordId]',
  },
  ({ userId, params }) =>
    SiteSeoService.removeKeyword(
      userId,
      params.id,
      params.siteId,
      params.keywordId,
    ),
)
