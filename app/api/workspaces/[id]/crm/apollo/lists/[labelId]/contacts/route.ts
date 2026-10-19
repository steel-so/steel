import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ApolloListContactsSchema } from '@/src/schemas/crm-apollo.schema'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

/** Preview of the contacts saved in an Apollo list — 0 credits. */
export const POST = sdConfigRoute({
  body: ApolloListContactsSchema,
  allowEmptyBody: true,
  handler: ({ userId, params, body }) =>
    CrmApolloService.listContacts(userId, params.id, params.labelId, body),
})
