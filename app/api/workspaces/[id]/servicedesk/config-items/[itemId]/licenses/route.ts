import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdLicenseService } from '@/src/services/sd-license.service'

/** Licenças de software atribuídas a um ativo da CMDB. */
export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdLicenseService.forConfigItem(userId, params.id, params.itemId),
})
