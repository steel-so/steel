import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmCnpjEnrichmentService } from '@/src/services/crm-cnpj-enrichment.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmCnpjEnrichmentService.getRun(userId, params.id, params.runId),
})
