import {
  type SuggestSiteImagesDTO,
  SuggestSiteImagesSchema,
} from '@/src/schemas/site-ai.schema'
import { SiteAiService } from '@/src/services/site-ai.service'
import { siteAiRoute } from '../../../_lib/ai-handler'

type Params = { id: string; siteId: string }

/** Suggests images (media library or placeholders) and alt texts. */
export const POST = siteAiRoute<Params, SuggestSiteImagesDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/ai/images',
    body: SuggestSiteImagesSchema,
  },
  ({ userId, params, body }) =>
    SiteAiService.suggestImages(userId, params.id, params.siteId, body),
)
