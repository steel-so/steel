import { decodePageCursor, pageResultToV1 } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { ListV1SdCustomersSchema } from '@/src/schemas/api-v1.schema'
import { CreateSdCustomerSchema } from '@/src/schemas/sd-customer.schema'
import { SdCustomerService } from '@/src/services/sd-customer.service'

/** Customers and companies of the ServiceDesk, by name. */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdCustomersSchema,
  handler: async ({ session, query }) => {
    const page = decodePageCursor(query.cursor)
    if (!page.ok) return page
    const result = await SdCustomerService.list(
      session.userId,
      session.workspaceId,
      {
        page: page.value,
        pageSize: query.limit,
        order: 'asc',
        sort: 'name',
        q: query.q,
        kind: query.kind,
        active: query.active,
        state: query.state?.toUpperCase(),
        city: query.city,
      },
    )
    if (!result.ok) return result
    return ok(pageResultToV1(result.value))
  },
})

/** Same entry as the app: emits `servicedesk.customer.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/customers',
  body: CreateSdCustomerSchema,
  status: 201,
  handler: ({ session, body }) =>
    SdCustomerService.create(session.userId, session.workspaceId, body),
})
