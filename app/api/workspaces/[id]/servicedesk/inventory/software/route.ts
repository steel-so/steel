import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListSdInventorySoftwareSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryService } from '@/src/services/sd-inventory.service'

export const GET = sdConfigRoute({
  query: ListSdInventorySoftwareSchema,
  handler: ({ userId, params, query }) =>
    SdInventoryService.listSoftware(userId, params.id, query),
})
