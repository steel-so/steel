import { siteRoute } from '@/app/api/workspaces/[id]/crm/sites/_lib/handler'
import { BioLinkService } from '@/src/services/bio-link.service'

type Params = { id: string }

/** Connected WhatsApp lines, published sites and published CRM forms: the
 * choices of the editor's ready-made buttons. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  BioLinkService.options(userId, params.id),
)
