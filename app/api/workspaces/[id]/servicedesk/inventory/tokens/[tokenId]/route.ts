import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryTokenService } from '@/src/services/sd-inventory-token.service'

/** Revoga o token: o agente que o usa para de enviar na hora. */
export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/servicedesk/inventory/tokens/[tokenId]',
  handler: ({ userId, params }) =>
    SdInventoryTokenService.revoke(userId, params.id, params.tokenId),
})
