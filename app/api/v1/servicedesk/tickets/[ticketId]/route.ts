import { apiV1Route } from '@/src/lib/api/v1-route'
import { SdTicketService } from '@/src/services/sd-ticket.service'

/** `steel sd ticket view`: `ticketId` is the id, the number or the code. */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  handler: ({ session, params }) =>
    SdTicketService.get(session.userId, session.workspaceId, params.ticketId),
})
