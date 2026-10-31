import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdLicenseService } from '@/src/services/sd-license.service'

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/licenses/[licenseId]/restore',
  allowEmptyBody: true,
  handler: ({ userId, params }) =>
    SdLicenseService.archive(userId, params.id, params.licenseId, false),
})
