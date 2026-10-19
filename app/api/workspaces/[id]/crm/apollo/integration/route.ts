import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  ConnectApolloSchema,
  UpdateApolloSettingsSchema,
} from '@/src/schemas/crm-apollo.schema'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmApolloService.getConnection(userId, params.id),
})

export const PUT = sdConfigRoute({
  consent: 'PUT /api/workspaces/[id]/crm/apollo/integration',
  body: ConnectApolloSchema,
  handler: ({ userId, params, body }) =>
    CrmApolloService.connect(userId, params.id, body),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/crm/apollo/integration',
  body: UpdateApolloSettingsSchema,
  handler: ({ userId, params, body }) =>
    CrmApolloService.updateSettings(userId, params.id, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/crm/apollo/integration',
  handler: ({ userId, params }) =>
    CrmApolloService.disconnect(userId, params.id),
})
