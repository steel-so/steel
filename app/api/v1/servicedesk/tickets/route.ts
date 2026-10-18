import { validationError } from '@/src/errors/app-error'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { err, ok } from '@/src/lib/result'
import {
  ListV1SdTicketsSchema,
  V1_CLOSED_PHASE_CATEGORIES,
} from '@/src/schemas/api-v1.schema'
import {
  CreateSdTicketSchema,
  ListSdTicketsSchema,
} from '@/src/schemas/sd-ticket.schema'
import { SdTicketService } from '@/src/services/sd-ticket.service'

const closed = new Set<string>(V1_CLOSED_PHASE_CATEGORIES)

/** `steel sd ticket list`, over the app's ticket list (cursor by id). */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdTicketsSchema,
  handler: async ({ session, query }) => {
    const filters = ListSdTicketsSchema.safeParse({
      types: query.type,
      phaseCategories: query.status,
      phaseIds: query.phaseId,
      priorityIds: query.priorityId,
      assigneeIds: query.assigneeId,
      q: query.q,
      includeClosed: query.status?.some((status) => closed.has(status)),
      pageSize: query.limit,
      cursor: query.cursor,
    })
    // Only the cursor can fail here (a ticket cursor is an id).
    if (!filters.success) {
      return err(validationError('Cursor inválido', filters.error.issues))
    }
    const result = await SdTicketService.list(
      session.userId,
      session.workspaceId,
      filters.data,
    )
    if (!result.ok) return result
    return ok({
      items: result.value.items,
      nextCursor: result.value.nextCursor,
    })
  },
})

/** `steel sd ticket create`. Channel `API` unless the body says otherwise. */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/tickets',
  body: CreateSdTicketSchema,
  status: 201,
  handler: ({ session, body }) =>
    SdTicketService.create(session.userId, session.workspaceId, {
      ...body,
      channel: body.channel ?? 'API',
    }),
})
