import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdInventorySnmpTargetSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryTargetService } from '@/src/services/sd-inventory-target.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryTargetService.list(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/inventory/snmp-targets',
  body: CreateSdInventorySnmpTargetSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdInventoryTargetService.create(userId, params.id, body),
})
