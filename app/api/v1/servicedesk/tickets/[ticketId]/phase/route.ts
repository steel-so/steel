import { apiV1Route } from '@/src/lib/api/v1-route'
import { MoveSdTicketPhaseSchema } from '@/src/schemas/sd-ticket.schema'
import { SdTicketService } from '@/src/services/sd-ticket.service'

/** `steel sd ticket move` (agents only, as in the app). */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/tickets/[ticketId]/phase',
  body: MoveSdTicketPhaseSchema,
  handler: ({ session, params, body }) =>
    SdTicketService.movePhase(
      session.userId,
      session.workspaceId,
      params.ticketId,
      body,
    ),
})
