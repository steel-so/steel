import { apiV1Route } from '@/src/lib/api/v1-route'
import { MoveV1CrmOpportunityStageSchema } from '@/src/schemas/api-v1.schema'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'

/** `steel crm opportunity move`: the app's update with only the stage. */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/opportunities/[opportunityId]/stage',
  body: MoveV1CrmOpportunityStageSchema,
  handler: ({ session, params, body }) =>
    CrmOpportunityService.update(
      session.userId,
      session.workspaceId,
      params.opportunityId,
      { stageId: body.stageId, pipelineId: body.pipelineId },
    ),
})
