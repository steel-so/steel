import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SetSdLicenseAssetsSchema } from '@/src/schemas/sd-license.schema'
import { SdLicenseService } from '@/src/services/sd-license.service'

/** Troca o conjunto de ativos da CMDB cobertos pela licença. */
export const PUT = sdConfigRoute({
  consent: 'PUT /api/workspaces/[id]/servicedesk/licenses/[licenseId]/assets',
  body: SetSdLicenseAssetsSchema,
  handler: ({ userId, params, body }) =>
    SdLicenseService.setAssets(userId, params.id, params.licenseId, body),
})
