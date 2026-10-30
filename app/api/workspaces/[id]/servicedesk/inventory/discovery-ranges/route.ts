import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdInventoryDiscoveryRangeSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryDiscoveryService } from '@/src/services/sd-inventory-discovery.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryDiscoveryService.list(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/inventory/discovery-ranges',
  body: CreateSdInventoryDiscoveryRangeSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdInventoryDiscoveryService.create(userId, params.id, body),
})
