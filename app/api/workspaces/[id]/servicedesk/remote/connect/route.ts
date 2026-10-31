import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ConnectSdRemoteSchema } from '@/src/schemas/sd-remote.schema'
import { SdRemoteService } from '@/src/services/sd-remote.service'

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/remote/connect',
  body: ConnectSdRemoteSchema,
  handler: ({ userId, params, body }) =>
    SdRemoteService.connect(userId, params.id, body),
})
