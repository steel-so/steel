import { apiV1Route } from '@/src/lib/api/v1-route'
import { CreateV1SdTicketCommentSchema } from '@/src/schemas/api-v1.schema'
import { SdTicketMessageService } from '@/src/services/sd-ticket-message.service'

/** `steel sd ticket comment`: a public or internal message, no attachments. */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/tickets/[ticketId]/comments',
  body: CreateV1SdTicketCommentSchema,
  status: 201,
  handler: ({ session, params, body }) =>
    SdTicketMessageService.create(
      session.userId,
      session.workspaceId,
      params.ticketId,
      {
        body: body.body,
        visibility: body.visibility,
        attachmentIds: [],
      },
    ),
})
