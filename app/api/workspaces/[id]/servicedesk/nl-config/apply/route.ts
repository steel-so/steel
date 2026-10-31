import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdNlConfigApplySchema } from '@/src/schemas/sd-nl-config.schema'
import { SdNlConfigService } from '@/src/services/sd-nl-config.service'

/** Grava a configuração que o admin confirmou na prévia. */
export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/nl-config/apply',
  body: SdNlConfigApplySchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdNlConfigService.apply(userId, params.id, body),
})
