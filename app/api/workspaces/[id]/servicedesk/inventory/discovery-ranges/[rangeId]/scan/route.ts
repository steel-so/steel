import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryDiscoveryService } from '@/src/services/sd-inventory-discovery.service'

/** "Varrer agora": enfileira a faixa (só com a descoberta ligada). */
export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/inventory/discovery-ranges/[rangeId]/scan',
  handler: ({ userId, params }) =>
    SdInventoryDiscoveryService.scanNow(userId, params.id, params.rangeId),
})
