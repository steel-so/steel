import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryDeviceActionsService } from '@/src/services/sd-inventory-device-actions.service'

/** Adota um equipamento descoberto (passa a ser gerido e vai para a CMDB). */
export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/inventory/devices/[deviceId]/adopt',
  handler: ({ userId, params }) =>
    SdInventoryDeviceActionsService.adopt(userId, params.id, params.deviceId),
})
