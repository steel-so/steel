import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ListSdInventoryAlertsSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryService } from '@/src/services/sd-inventory.service'

export const GET = sdConfigRoute({
  query: ListSdInventoryAlertsSchema,
  handler: ({ userId, params, query }) =>
    SdInventoryService.listAlerts(userId, params.id, query),
})
