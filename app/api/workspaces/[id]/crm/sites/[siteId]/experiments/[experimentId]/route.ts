import {
  type UpdateSiteExperimentDTO,
  UpdateSiteExperimentSchema,
} from '@/src/schemas/site-experiment.schema'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string; experimentId: string }

const ROUTE =
  '/api/workspaces/[id]/crm/sites/[siteId]/experiments/[experimentId]'

export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteExperimentService.get(
    userId,
    params.id,
    params.siteId,
    params.experimentId,
  ),
)

export const PATCH = siteRoute<Params, UpdateSiteExperimentDTO>(
  { consent: ROUTE, body: UpdateSiteExperimentSchema },
  ({ userId, params, body }) =>
    SiteExperimentService.update(
      userId,
      params.id,
      params.siteId,
      params.experimentId,
      body,
    ),
)

export const DELETE = siteRoute<Params>(
  { consent: ROUTE },
  ({ userId, params }) =>
    SiteExperimentService.remove(
      userId,
      params.id,
      params.siteId,
      params.experimentId,
    ),
)
