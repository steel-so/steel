import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryDeviceActionsService } from '@/src/services/sd-inventory-device-actions.service'

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/inventory/devices/[deviceId]/unmerge',
  handler: ({ userId, params }) =>
    SdInventoryDeviceActionsService.unmerge(userId, params.id, params.deviceId),
})
