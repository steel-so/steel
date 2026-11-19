import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SearchGoogleCategoriesSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'

export const GET = sdConfigRoute({
  query: SearchGoogleCategoriesSchema,
  handler: ({ userId, params, query }) =>
    CrmGoogleProfileService.searchCategories(userId, params.id, query.q),
})
