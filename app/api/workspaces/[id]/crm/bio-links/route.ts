import { siteRoute } from '@/app/api/workspaces/[id]/crm/sites/_lib/handler'
import {
  type CreateBioLinkDTO,
  CreateBioLinkSchema,
} from '@/src/schemas/bio-link.schema'
import { BioLinkService } from '@/src/services/bio-link.service'

type Params = { id: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  BioLinkService.list(userId, params.id),
)

export const POST = siteRoute<Params, CreateBioLinkDTO>(
  {
    consent: '/api/workspaces/[id]/crm/bio-links',
    body: CreateBioLinkSchema,
    status: 201,
  },
  ({ userId, params, body }) => BioLinkService.create(userId, params.id, body),
)
