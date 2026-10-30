import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { MergeSdInventoryDeviceSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryDeviceActionsService } from '@/src/services/sd-inventory-device-actions.service'

/** Mescla manual: este equipamento vira secundário de `intoId`. */
export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/inventory/devices/[deviceId]/merge',
  body: MergeSdInventoryDeviceSchema,
  handler: ({ userId, params, body }) =>
    SdInventoryDeviceActionsService.merge(
      userId,
      params.id,
      params.deviceId,
      body.intoId,
    ),
})
