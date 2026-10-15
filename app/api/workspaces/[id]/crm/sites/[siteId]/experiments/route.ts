import {
  type CreateSiteExperimentDTO,
  CreateSiteExperimentSchema,
} from '@/src/schemas/site-experiment.schema'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteExperimentService.list(userId, params.id, params.siteId),
)

export const POST = siteRoute<Params, CreateSiteExperimentDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/experiments',
    body: CreateSiteExperimentSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteExperimentService.create(userId, params.id, params.siteId, body),
)
