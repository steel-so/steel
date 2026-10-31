import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdLicenseSchema } from '@/src/schemas/sd-license.schema'
import { SdLicenseService } from '@/src/services/sd-license.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdLicenseService.get(userId, params.id, params.licenseId),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/licenses/[licenseId]',
  body: UpdateSdLicenseSchema,
  handler: ({ userId, params, body }) =>
    SdLicenseService.update(userId, params.id, params.licenseId, body),
})

/** Arquiva a licença (some das listas e dos avisos). */
export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/servicedesk/licenses/[licenseId]',
  handler: ({ userId, params }) =>
    SdLicenseService.archive(userId, params.id, params.licenseId, true),
})
