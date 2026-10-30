import { useMutation } from '@tanstack/react-query'
import type { CrmNlSearchEntityKey } from '@/app/_components/crm/crm-nl-search-result'
import type {
  CrmNlCompanySearchResultDTO,
  CrmNlLeadSearchResultDTO,
  CrmNlPersonSearchResultDTO,
  CrmNlSearchResultDTO,
} from '@/types/crm-nl-search'
import { apiFetch } from './_fetch'

interface ResultByEntity {
  opportunities: CrmNlSearchResultDTO
  leads: CrmNlLeadSearchResultDTO
  people: CrmNlPersonSearchResultDTO
  companies: CrmNlCompanySearchResultDTO
}

/**
 * Search of opportunities, leads, people or companies by a free question in
 * Portuguese (C10). Opportunities by default.
 */
export function useCrmNlSearch<
  E extends CrmNlSearchEntityKey = 'opportunities',
>(workspaceId: string, entity: E = 'opportunities' as E) {
  return useMutation({
    mutationFn: (query: string) =>
      apiFetch<ResultByEntity[E]>(
        `/api/workspaces/${workspaceId}/crm/${entity}/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        },
        'Não foi possível fazer a busca',
      ),
  })
}
