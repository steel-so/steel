import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdInventoryAgentUpdateService } from '@/src/services/sd-inventory-agent-update.service'

/** Última versão do agente publicada por sistema/arquitetura (admin). */
export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventoryAgentUpdateService.listLatest(userId, params.id),
})
