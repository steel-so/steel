import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryService } from '@/src/services/sd-inventory.service'
import { SdInventoryDeviceActionsService } from '@/src/services/sd-inventory-device-actions.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryService.getDevice(userId, params.id, params.deviceId),
})

/** Descarta um equipamento descoberto que ninguém vai adotar. */
export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/inventory/devices/[deviceId]',
  handler: ({ userId, params }) =>
    SdInventoryDeviceActionsService.dismiss(userId, params.id, params.deviceId),
})
