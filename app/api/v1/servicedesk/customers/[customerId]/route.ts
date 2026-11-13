import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateSdCustomerSchema } from '@/src/schemas/sd-customer.schema'
import { SdCustomerService } from '@/src/services/sd-customer.service'

/** With the contacts and the last 10 tickets. */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  handler: ({ session, params }) =>
    SdCustomerService.get(
      session.userId,
      session.workspaceId,
      params.customerId,
    ),
})

export const PATCH = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'PATCH /api/v1/servicedesk/customers/[customerId]',
  body: UpdateSdCustomerSchema,
  handler: ({ session, params, body }) =>
    SdCustomerService.update(
      session.userId,
      session.workspaceId,
      params.customerId,
      body,
    ),
})

export const DELETE = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'DELETE /api/v1/servicedesk/customers/[customerId]',
  handler: async ({ session, params }) => {
    const result = await SdCustomerService.remove(
      session.userId,
      session.workspaceId,
      params.customerId,
    )
    if (!result.ok) return result
    return ok({ id: params.customerId })
  },
})
