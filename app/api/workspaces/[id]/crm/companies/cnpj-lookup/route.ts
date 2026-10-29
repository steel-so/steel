import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { LookupCnpjSchema } from '@/src/schemas/crm-cnpj.schema'
import { CrmCnpjEnrichmentService } from '@/src/services/crm-cnpj-enrichment.service'

export const POST = sdConfigRoute({
  body: LookupCnpjSchema,
  handler: ({ userId, params, body }) =>
    CrmCnpjEnrichmentService.lookup(userId, params.id, body),
})
