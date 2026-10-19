import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1WhatsAppWaitingConversationsSchema } from '@/src/schemas/api-v1.schema'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'

/**
 * The agents' queue for the CLI: open conversations with no agent, as the
 * token's owner sees them in the inbox ("Fila"), oldest first.
 */
export const GET = apiV1Route({
  access: 'read',
  module: 'COMMUNICATION',
  query: ListV1WhatsAppWaitingConversationsSchema,
  handler: async ({ session, query }) => {
    const result = await WhatsAppConversationService.listWaiting(
      session.userId,
      session.workspaceId,
      { connectionId: query.connectionId, teamId: query.teamId },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})
