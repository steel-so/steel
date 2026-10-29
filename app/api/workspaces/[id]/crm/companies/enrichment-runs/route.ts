import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  ListCnpjRunsSchema,
  StartCnpjRunSchema,
} from '@/src/schemas/crm-cnpj.schema'
import { CrmCnpjEnrichmentService } from '@/src/services/crm-cnpj-enrichment.service'

export const GET = sdConfigRoute({
  query: ListCnpjRunsSchema,
  handler: ({ userId, params, query }) =>
    CrmCnpjEnrichmentService.listRuns(userId, params.id, query),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/crm/companies/enrichment-runs',
  body: StartCnpjRunSchema,
  allowEmptyBody: true,
  status: 202,
  handler: ({ userId, params, body }) =>
    CrmCnpjEnrichmentService.startRun(userId, params.id, body),
})
