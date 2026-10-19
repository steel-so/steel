import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/crm/apollo/integration/test',
  handler: ({ userId, params }) => CrmApolloService.test(userId, params.id),
})
