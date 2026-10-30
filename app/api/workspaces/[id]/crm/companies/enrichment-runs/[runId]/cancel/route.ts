import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CrmCnpjEnrichmentService } from '@/src/services/crm-cnpj-enrichment.service'

/** Stops a queued or running bulk CNPJ enrichment (OWNER/ADMIN). */
export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/crm/companies/enrichment-runs/[runId]/cancel',
  allowEmptyBody: true,
  handler: ({ userId, params }) =>
    CrmCnpjEnrichmentService.cancelRun(userId, params.id, params.runId),
})
