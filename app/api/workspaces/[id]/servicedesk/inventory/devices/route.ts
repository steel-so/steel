import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListSdInventoryDevicesSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryService } from '@/src/services/sd-inventory.service'

export const GET = sdConfigRoute({
  query: ListSdInventoryDevicesSchema,
  handler: ({ userId, params, query }) =>
    SdInventoryService.listDevices(userId, params.id, query),
})
