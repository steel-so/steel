import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListSdRemoteSessionsSchema } from '@/src/schemas/sd-remote.schema'
import { SdRemoteService } from '@/src/services/sd-remote.service'

export const GET = sdConfigRoute({
  query: ListSdRemoteSessionsSchema,
  handler: ({ userId, params, query }) =>
    SdRemoteService.listSessions(userId, params.id, query),
})
