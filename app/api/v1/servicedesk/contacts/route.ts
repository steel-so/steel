import {
  decodePageCursor,
  pageResultToV1,
} from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { ListV1SdContactsSchema } from '@/src/schemas/api-v1.schema'
import { CreateSdContactSchema } from '@/src/schemas/sd-contact.schema'
import { SdContactService } from '@/src/services/sd-contact.service'

/** Contacts of the ServiceDesk, by name. */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdContactsSchema,
  handler: async ({ session, query }) => {
    const page = decodePageCursor(query.cursor)
    if (!page.ok) return page
    const result = await SdContactService.list(
      session.userId,
      session.workspaceId,
      {
        page: page.value,
        pageSize: query.limit,
        order: 'asc',
        sort: 'name',
        q: query.q,
        customerId: query.customerId,
        active: query.active,
      },
    )
    if (!result.ok) return result
    return ok(pageResultToV1(result.value))
  },
})

/** Same entry as the app: emits `servicedesk.contact.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/contacts',
  body: CreateSdContactSchema,
  status: 201,
  handler: ({ session, body }) =>
    SdContactService.create(session.userId, session.workspaceId, body),
})
