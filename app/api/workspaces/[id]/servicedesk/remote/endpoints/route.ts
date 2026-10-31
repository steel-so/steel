import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  ListSdRemoteEndpointsSchema,
  UpsertSdRemoteEndpointSchema,
} from '@/src/schemas/sd-remote.schema'
import { SdRemoteService } from '@/src/services/sd-remote.service'

export const GET = sdConfigRoute({
  query: ListSdRemoteEndpointsSchema,
  handler: ({ userId, params, query }) =>
    SdRemoteService.listEndpoints(userId, params.id, query.configItemId),
})

export const PUT = sdConfigRoute({
  consent: 'PUT /api/workspaces/[id]/servicedesk/remote/endpoints',
  body: UpsertSdRemoteEndpointSchema,
  handler: ({ userId, params, body }) =>
    SdRemoteService.upsertEndpoint(userId, params.id, body),
})
