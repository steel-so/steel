import {
  type SiteExperimentActionDTO,
  SiteExperimentActionSchema,
} from '@/src/schemas/site-experiment.schema'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; experimentId: string }

/** Start, pause, resume, stop or restart a test. */
export const POST = siteRoute<Params, SiteExperimentActionDTO>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/experiments/[experimentId]/status',
    body: SiteExperimentActionSchema,
  },
  ({ userId, params, body }) =>
    SiteExperimentService.transition(
      userId,
      params.id,
      params.siteId,
      params.experimentId,
      body.action,
    ),
)
