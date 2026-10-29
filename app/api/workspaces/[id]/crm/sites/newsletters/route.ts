import { CrmNewsletterArchiveService } from '@/src/services/crm-newsletter-archive.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** ACTIVE newsletters of the workspace with their latest SENT issues: the
 * picker and the live preview of the `site.newsletter-*` elements. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  CrmNewsletterArchiveService.listForSiteEditor(userId, params.id),
)
