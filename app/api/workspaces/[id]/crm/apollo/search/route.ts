import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ApolloSearchSchema } from '@/src/schemas/crm-apollo.schema'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

/** Preview of a people search — 0 Apollo credits (POST only to carry filters). */
export const POST = sdConfigRoute({
  body: ApolloSearchSchema,
  handler: ({ userId, params, body }) =>
    CrmApolloService.search(userId, params.id, body),
})
