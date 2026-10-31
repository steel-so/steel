import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdNlConfigPreviewSchema } from '@/src/schemas/sd-nl-config.schema'
import { SdNlConfigService } from '@/src/services/sd-nl-config.service'

/** Prévia de uma configuração descrita em texto. Nunca salva. */
export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/nl-config/preview',
  body: SdNlConfigPreviewSchema,
  handler: ({ userId, params, body }) =>
    SdNlConfigService.preview(userId, params.id, body),
})
