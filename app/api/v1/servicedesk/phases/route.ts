import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1SdPhasesSchema } from '@/src/schemas/api-v1.schema'
import { ApiV1Service } from '@/src/services/api-v1.service'

/**
 * Phases for `steel sd ticket move`: the active ones, per ticket type in
 * board order, each with the phases a ticket may move to next.
 */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdPhasesSchema,
  handler: async ({ session, query }) => {
    const result = await ApiV1Service.listSdPhases(
      session.userId,
      session.workspaceId,
      query.ticketType,
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})
