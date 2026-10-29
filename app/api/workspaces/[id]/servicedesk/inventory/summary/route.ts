import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryService } from '@/src/services/sd-inventory.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryService.summary(userId, params.id),
})
