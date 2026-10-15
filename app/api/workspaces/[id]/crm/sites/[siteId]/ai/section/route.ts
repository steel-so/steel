import {
  type GenerateSiteSectionDTO,
  GenerateSiteSectionSchema,
} from '@/src/schemas/site-ai.schema'
import { SiteAiService } from '@/src/services/site-ai.service'
import { siteAiRoute } from '../../../_lib/ai-handler'

type Params = { id: string; siteId: string }

/** Generates one section (validated fragment) from a request. */
export const POST = siteAiRoute<Params, GenerateSiteSectionDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/ai/section',
    body: GenerateSiteSectionSchema,
  },
  ({ userId, params, body }) =>
    SiteAiService.generateSection(userId, params.id, params.siteId, body),
)
