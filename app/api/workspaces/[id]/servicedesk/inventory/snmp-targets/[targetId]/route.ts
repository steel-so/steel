import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdInventorySnmpTargetSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryTargetService } from '@/src/services/sd-inventory-target.service'

export const PATCH = sdConfigRoute({
  consent:
    'PATCH /api/workspaces/[id]/servicedesk/inventory/snmp-targets/[targetId]',
  body: UpdateSdInventorySnmpTargetSchema,
  handler: ({ userId, params, body }) =>
    SdInventoryTargetService.update(userId, params.id, params.targetId, body),
})

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/inventory/snmp-targets/[targetId]',
  handler: ({ userId, params }) =>
    SdInventoryTargetService.remove(userId, params.id, params.targetId),
})
