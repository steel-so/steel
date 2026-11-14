import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateSdContactSchema } from '@/src/schemas/sd-contact.schema'
import { SdContactService } from '@/src/services/sd-contact.service'

/** With the last 10 tickets. */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  handler: ({ session, params }) =>
    SdContactService.get(session.userId, session.workspaceId, params.contactId),
})

export const PATCH = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'PATCH /api/v1/servicedesk/contacts/[contactId]',
  body: UpdateSdContactSchema,
  handler: ({ session, params, body }) =>
    SdContactService.update(
      session.userId,
      session.workspaceId,
      params.contactId,
      body,
    ),
})

export const DELETE = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'DELETE /api/v1/servicedesk/contacts/[contactId]',
  handler: async ({ session, params }) => {
    const result = await SdContactService.remove(
      session.userId,
      session.workspaceId,
      params.contactId,
    )
    if (!result.ok) return result
    return ok({ id: params.contactId })
  },
})
