import { siteRoute } from '@/app/api/workspaces/[id]/crm/sites/_lib/handler'
import {
  type UpdateBioLinkDTO,
  UpdateBioLinkSchema,
} from '@/src/schemas/bio-link.schema'
import { BioLinkService } from '@/src/services/bio-link.service'

type Params = { id: string; bioLinkId: string }

const ROUTE = '/api/workspaces/[id]/crm/bio-links/[bioLinkId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  BioLinkService.get(userId, params.id, params.bioLinkId),
)

export const PATCH = siteRoute<Params, UpdateBioLinkDTO>(
  { consent: ROUTE, body: UpdateBioLinkSchema },
  ({ userId, params, body }) =>
    BioLinkService.update(userId, params.id, params.bioLinkId, body),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    BioLinkService.remove(userId, params.id, params.bioLinkId),
)
