import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdRemoteService } from '@/src/services/sd-remote.service'

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/remote/endpoints/[endpointId]',
  handler: ({ userId, params }) =>
    SdRemoteService.deleteEndpoint(userId, params.id, params.endpointId),
})
