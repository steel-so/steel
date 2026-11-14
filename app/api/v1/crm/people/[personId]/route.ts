import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateCrmPersonSchema } from '@/src/schemas/crm-person.schema'
import { CrmPersonService } from '@/src/services/crm-person.service'

export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  handler: ({ session, params }) =>
    CrmPersonService.getById(
      session.userId,
      session.workspaceId,
      params.personId,
    ),
})

export const PATCH = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'PATCH /api/v1/crm/people/[personId]',
  body: UpdateCrmPersonSchema,
  handler: ({ session, params, body }) =>
    CrmPersonService.update(
      session.userId,
      session.workspaceId,
      params.personId,
      body,
    ),
})

export const DELETE = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'DELETE /api/v1/crm/people/[personId]',
  handler: async ({ session, params }) => {
    const result = await CrmPersonService.remove(
      session.userId,
      session.workspaceId,
      params.personId,
    )
    if (!result.ok) return result
    return ok({ id: params.personId })
  },
})
