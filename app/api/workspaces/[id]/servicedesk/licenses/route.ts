import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  CreateSdLicenseSchema,
  ListSdLicensesQuerySchema,
} from '@/src/schemas/sd-license.schema'
import { SdLicenseService } from '@/src/services/sd-license.service'

export const GET = sdConfigRoute({
  query: ListSdLicensesQuerySchema,
  handler: ({ userId, params, query }) =>
    SdLicenseService.list(userId, params.id, query),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/licenses',
  body: CreateSdLicenseSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdLicenseService.create(userId, params.id, body),
})
