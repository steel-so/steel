import type {
  CrmNlCompanyFilter,
  CrmNlLeadFilter,
  CrmNlPersonFilter,
  CrmNlSearchFilter,
} from '@/src/schemas/crm-nl-search.schema'
import type { CrmCompanyDTO } from './crm-company'
import type { CrmLeadDTO } from './crm-lead'
import type { CrmOpportunityDTO } from './crm-opportunity'
import type { CrmPersonDTO } from './crm-person'

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

/** Result of the search over leads, people or companies (same shape for all). */
export interface CrmNlEntitySearchResultDTO<TItem, TFilter> {
  /** The question as asked. */
  query: string
  /** How the question was read, as pt-BR chips. */
  interpretation: string[]
  /** The structured filter that ran (validated; never free-form). */
  filter: TFilter
  items: TItem[]
  /** True when more rows matched than the cap returned. */
  truncated: boolean
}

export type CrmNlLeadSearchResultDTO = CrmNlEntitySearchResultDTO<
  CrmLeadDTO,
  CrmNlLeadFilter
>
export type CrmNlPersonSearchResultDTO = CrmNlEntitySearchResultDTO<
  CrmPersonDTO,
  CrmNlPersonFilter
>
export type CrmNlCompanySearchResultDTO = CrmNlEntitySearchResultDTO<
  CrmCompanyDTO,
  CrmNlCompanyFilter
>
