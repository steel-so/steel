import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateCrmCompanySchema } from '@/src/schemas/crm-company.schema'
import { CrmCompanyService } from '@/src/services/crm-company.service'

export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  handler: ({ session, params }) =>
    CrmCompanyService.getById(
      session.userId,
      session.workspaceId,
      params.companyId,
    ),
})

export const PATCH = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'PATCH /api/v1/crm/companies/[companyId]',
  body: UpdateCrmCompanySchema,
  handler: ({ session, params, body }) =>
    CrmCompanyService.update(
      session.userId,
      session.workspaceId,
      params.companyId,
      body,
    ),
})

export const DELETE = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'DELETE /api/v1/crm/companies/[companyId]',
  handler: async ({ session, params }) => {
    const result = await CrmCompanyService.remove(
      session.userId,
      session.workspaceId,
      params.companyId,
    )
    if (!result.ok) return result
    return ok({ id: params.companyId })
  },
})
