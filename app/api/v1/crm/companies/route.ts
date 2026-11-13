import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1CrmCompaniesSchema } from '@/src/schemas/api-v1.schema'
import { CreateCrmCompanySchema } from '@/src/schemas/crm-company.schema'
import { CrmCompanyService } from '@/src/services/crm-company.service'

/** Companies of the CRM, in the app's order. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: ListV1CrmCompaniesSchema,
  handler: async ({ session, query }) => {
    const result = await CrmCompanyService.list(
      session.userId,
      session.workspaceId,
      { icp: query.icp },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})

/** Same entry as the app: emits `crm.company.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/companies',
  body: CreateCrmCompanySchema,
  status: 201,
  handler: ({ session, body }) =>
    CrmCompanyService.create(session.userId, session.workspaceId, body),
})
