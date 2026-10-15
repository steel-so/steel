import {
  type ApplySiteExperimentWinnerDTO,
  ApplySiteExperimentWinnerSchema,
} from '@/src/schemas/site-experiment.schema'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; experimentId: string }

/** "Aplicar vencedora": the variant goes into the draft and the test ends. */
export const POST = siteRoute<Params, ApplySiteExperimentWinnerDTO>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/experiments/[experimentId]/apply-winner',
    body: ApplySiteExperimentWinnerSchema,
  },
  ({ userId, params, body }) =>
    SiteExperimentService.applyWinner(
      userId,
      params.id,
      params.siteId,
      params.experimentId,
      body.variantKey,
    ),
)
