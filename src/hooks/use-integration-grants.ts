import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OAuthConsentInput } from '@/src/schemas/integration-grant.schema'
import type {
  IntegrationGrantDTO,
  OAuthConsentResultDTO,
} from '@/types/integration-grant'
import { apiFetch, apiFetchJson } from './_fetch'

const GRANTS_KEY = ['integration-grants', 'me']
const BASE_API_ROUTE = '/api/users/me/integration-grants'

/** "Apps conectados" of the signed-in user (ADR 0033). */
export function useIntegrationGrants(enabled = true) {
  return useQuery({
    queryKey: GRANTS_KEY,
    queryFn: () =>
      apiFetch<IntegrationGrantDTO[]>(
        BASE_API_ROUTE,
        undefined,
        'Erro ao carregar os apps conectados',
      ),
    enabled,
  })
}

export function useRevokeIntegrationGrant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<{ id: string }>(
        `${BASE_API_ROUTE}/${encodeURIComponent(id)}`,
        'DELETE',
        undefined,
        'Erro ao revogar o app',
      ),
    onSuccess: ({ id }) => {
      queryClient.setQueryData<IntegrationGrantDTO[]>(GRANTS_KEY, (grants) =>
        grants?.filter((grant) => grant.id !== id),
      )
    },
  })
}

/** Answer of the consent page; the caller navigates to `redirectUrl`. */
export function useAnswerOAuthConsent() {
  return useMutation({
    mutationFn: (input: OAuthConsentInput) =>
      apiFetchJson<OAuthConsentResultDTO>(
        '/api/oauth/consent',
        'POST',
        input,
        'Não foi possível concluir a autorização',
      ),
  })
}
