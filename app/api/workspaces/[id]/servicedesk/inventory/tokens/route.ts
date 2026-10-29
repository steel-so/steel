import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdInventoryTokenSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventoryTokenService } from '@/src/services/sd-inventory-token.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryTokenService.list(userId, params.id),
})

/** O valor do token aparece só na resposta desta criação. */
export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/inventory/tokens',
  body: CreateSdInventoryTokenSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdInventoryTokenService.create(userId, params.id, body),
})
