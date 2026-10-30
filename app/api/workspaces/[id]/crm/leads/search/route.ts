import { crmNlSearchRoute } from '@/src/lib/crm-nl-search-route'
import { CrmNlSearchService } from '@/src/services/crm-nl-search.service'

/** Search of leads by a free question in Portuguese (C10). */
export const POST = crmNlSearchRoute(CrmNlSearchService.searchLeads)
