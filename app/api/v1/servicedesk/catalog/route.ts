import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1SdCatalogSchema } from '@/src/schemas/api-v1.schema'
import { SdCategoryService } from '@/src/services/sd-category.service'

/**
 * Catalog for `steel sd ticket create`: categories, subcategories and
 * services as a flat, ordered list (`level` + `parentId`). Requesters see
 * only the active nodes visible on the portal, as in the app.
 */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdCatalogSchema,
  handler: async ({ session, query }) => {
    const result = await SdCategoryService.list(
      session.userId,
      session.workspaceId,
      { ticketType: query.ticketType, includeInactive: false },
    )
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})
