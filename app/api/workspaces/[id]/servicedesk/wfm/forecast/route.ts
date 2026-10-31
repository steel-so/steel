import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdWfmForecastQuerySchema } from '@/src/schemas/sd-wfm.schema'
import { SdWfmService } from '@/src/services/sd-wfm.service'

export const GET = sdConfigRoute({
  query: SdWfmForecastQuerySchema,
  handler: ({ userId, params, query }) =>
    SdWfmService.forecast(userId, params.id, query),
})
