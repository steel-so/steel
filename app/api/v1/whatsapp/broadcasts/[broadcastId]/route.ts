import { apiV1Route } from '@/src/lib/api/v1-route'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'

/** `steel zap broadcast status`: the broadcast with its recipients' status. */
export const GET = apiV1Route({
  access: 'read',
  module: 'COMMUNICATION',
  handler: ({ session, params }) =>
    WhatsAppBroadcastService.get(
      session.userId,
      session.workspaceId,
      params.broadcastId,
    ),
})
