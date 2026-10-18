import { paginateArray, V1PageQuerySchema } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ApiV1Service } from '@/src/services/api-v1.service'

/** Pipelines with their stages. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: V1PageQuerySchema,
  handler: async ({ session, query }) => {
    const result = await ApiV1Service.listPipelines(
      session.userId,
      session.workspaceId,
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})
