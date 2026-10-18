import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1CrmLeadsSchema } from '@/src/schemas/api-v1.schema'
import { CreateCrmLeadSchema } from '@/src/schemas/crm-lead.schema'
import { CrmLeadService } from '@/src/services/crm-lead.service'

/** `steel crm lead list`. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: ListV1CrmLeadsSchema,
  handler: async ({ session, query }) => {
    const result = await CrmLeadService.list(
      session.userId,
      session.workspaceId,
      { stage: query.stage },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})

/** `steel crm lead create`. An open lead with the same contact → 409. */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/leads',
  body: CreateCrmLeadSchema,
  status: 201,
  handler: ({ session, body }) =>
    CrmLeadService.create(session.userId, session.workspaceId, body),
})
