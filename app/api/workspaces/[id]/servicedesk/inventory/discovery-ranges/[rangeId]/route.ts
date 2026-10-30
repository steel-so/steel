import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdInventoryDiscoveryRangeSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryDiscoveryService } from '@/src/services/sd-inventory-discovery.service'

export const PATCH = sdConfigRoute({
  consent:
    'PATCH /api/workspaces/[id]/servicedesk/inventory/discovery-ranges/[rangeId]',
  body: UpdateSdInventoryDiscoveryRangeSchema,
  handler: ({ userId, params, body }) =>
    SdInventoryDiscoveryService.update(userId, params.id, params.rangeId, body),
})

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/inventory/discovery-ranges/[rangeId]',
  handler: ({ userId, params }) =>
    SdInventoryDiscoveryService.remove(userId, params.id, params.rangeId),
})
