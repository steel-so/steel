import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1CrmPeopleSchema } from '@/src/schemas/api-v1.schema'
import { CreateCrmPersonSchema } from '@/src/schemas/crm-person.schema'
import { CrmPersonService } from '@/src/services/crm-person.service'

/** People of the CRM, in the app's order. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: ListV1CrmPeopleSchema,
  handler: async ({ session, query }) => {
    const result = await CrmPersonService.list(
      session.userId,
      session.workspaceId,
      { companyId: query.companyId },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})

/** Same entry as the app: emits `crm.person.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/people',
  body: CreateCrmPersonSchema,
  status: 201,
  handler: ({ session, body }) =>
    CrmPersonService.create(session.userId, session.workspaceId, body),
})
