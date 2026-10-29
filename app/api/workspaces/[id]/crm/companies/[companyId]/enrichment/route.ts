import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { EnrichCompanySchema } from '@/src/schemas/crm-cnpj.schema'
import { CrmCnpjEnrichmentService } from '@/src/services/crm-cnpj-enrichment.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmCnpjEnrichmentService.getForCompany(userId, params.id, params.companyId),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/crm/companies/[companyId]/enrichment',
  body: EnrichCompanySchema,
  allowEmptyBody: true,
  handler: ({ userId, params, body }) =>
    CrmCnpjEnrichmentService.enrich(userId, params.id, params.companyId, body),
})
