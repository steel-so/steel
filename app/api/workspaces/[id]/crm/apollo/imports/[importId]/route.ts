import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmApolloService.getImport(userId, params.id, params.importId),
})
