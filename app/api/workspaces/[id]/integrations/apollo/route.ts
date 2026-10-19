import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ConnectApolloSchema } from '@/src/schemas/crm-apollo.schema'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

/** Same handlers as `crm/apollo/integration`, under the Ajustes > Integrações base. */
export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/integrations/apollo',
  body: ConnectApolloSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    CrmApolloService.connect(userId, params.id, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/integrations/apollo',
  handler: ({ userId, params }) =>
    CrmApolloService.disconnect(userId, params.id),
})
