import { SiteService } from '@/src/services/site.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; versionId: string }

/** Copies a version back into the draft; the live site changes only on the
 * next publish. */
export const POST = siteRoute<Params>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/versions/[versionId]/restore',
  },
  ({ userId, params }) =>
    SiteService.restoreVersion(
      userId,
      params.id,
      params.siteId,
      params.versionId,
    ),
)
