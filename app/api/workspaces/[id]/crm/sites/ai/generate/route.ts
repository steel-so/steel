import { logger } from '@/lib/axiom/logger'
import { siteAiSseResponse } from '@/src/lib/site-ai/sse'
import {
  type GenerateSiteDTO,
  GenerateSiteSchema,
} from '@/src/schemas/site-ai.schema'
import { SiteAiService } from '@/src/services/site-ai.service'
import { siteAiRoute } from '../../_lib/ai-handler'

type Params = { id: string }

/**
 * Generates a site with AI and streams the progress as
 * `text/event-stream` (`SiteAiEvent`). Errors found before the stream
 * starts (permission, plan, quota, site cap, form) answer with the JSON
 * envelope.
 */
export const POST = siteAiRoute<Params, GenerateSiteDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/ai/generate',
    body: GenerateSiteSchema,
  },
  async ({ userId, params, body }) => {
    const result = await SiteAiService.generateSite(userId, params.id, body)
    if (!result.ok) return result
    return siteAiSseResponse(result.value, (cause) =>
      logger.error('site_ai.stream_failed', {
        component: 'SiteAiGenerateRoute',
        workspaceId: params.id,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  },
)
