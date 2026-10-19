import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  CreateApolloImportSchema,
  ListApolloImportsSchema,
} from '@/src/schemas/crm-apollo.schema'
import { CrmApolloService } from '@/src/services/crm-apollo.service'

export const GET = sdConfigRoute({
  query: ListApolloImportsSchema,
  handler: ({ userId, params, query }) =>
    CrmApolloService.listImports(userId, params.id, query),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/crm/apollo/imports',
  body: CreateApolloImportSchema,
  status: 202,
  handler: ({ userId, params, body }) =>
    CrmApolloService.createImport(userId, params.id, body),
})
