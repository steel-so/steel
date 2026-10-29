import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryTargetService } from '@/src/services/sd-inventory-target.service'

/** "Varrer agora": enfileira o alvo para o worker. */
export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/inventory/snmp-targets/[targetId]/scan',
  handler: ({ userId, params }) =>
    SdInventoryTargetService.scanNow(userId, params.id, params.targetId),
})
