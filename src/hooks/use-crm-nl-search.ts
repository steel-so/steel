import { useMutation } from '@tanstack/react-query'
import type { CrmNlSearchResultDTO } from '@/types/crm-nl-search'
import { apiFetch } from './_fetch'

/** Opportunity search by a free question in Portuguese (C10). */
export function useCrmNlSearch(workspaceId: string) {
  return useMutation({
    mutationFn: (query: string) =>
      apiFetch<CrmNlSearchResultDTO>(
        `/api/workspaces/${workspaceId}/crm/opportunities/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        },
        'Não foi possível fazer a busca',
      ),
  })
}
