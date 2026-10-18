import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1CrmOpportunitiesSchema } from '@/src/schemas/api-v1.schema'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'

/** `steel crm opportunity list`. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: ListV1CrmOpportunitiesSchema,
  handler: async ({ session, query }) => {
    const result = await CrmOpportunityService.list(
      session.userId,
      session.workspaceId,
      { pipelineId: query.pipelineId, stageId: query.stageId },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})
