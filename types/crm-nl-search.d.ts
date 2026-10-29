import type { CrmNlSearchFilter } from '@/src/schemas/crm-nl-search.schema'
import type { CrmOpportunityDTO } from './crm-opportunity'

export interface CrmNlSearchResultDTO {
  /** The question as asked. */
  query: string
  /** How the question was read, as pt-BR chips ("Parados há 15 dias ou mais"). */
  interpretation: string[]
  /** The structured filter that ran (validated; never free-form). */
  filter: CrmNlSearchFilter
  opportunities: CrmOpportunityDTO[]
  /** True when more rows matched than the cap returned. */
  truncated: boolean
}
