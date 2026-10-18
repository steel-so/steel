import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateApiTokenInput,
  DeviceAuthorizeInput,
} from '@/src/schemas/api-token.schema'
import type {
  ApiTokenCreatedDTO,
  ApiTokenDTO,
  ApiTokenWorkspaceOptionDTO,
  DeviceAuthorizeResultDTO,
} from '@/types/api-token'
import { apiFetch, apiFetchJson } from './_fetch'

/** Ajustes › Segurança › Tokens de API (ADR 0035). */

export const API_TOKENS_KEY = ['api-tokens'] as const
const MY_TOKENS_KEY = [...API_TOKENS_KEY, 'me'] as const
const BASE_API_ROUTE = '/api/users/me/api-tokens'

/** The input the form sends; `expiresInDays` falls back to 90 on the server. */
export type CreateApiTokenRequest = Omit<CreateApiTokenInput, 'expiresInDays'> &
  Partial<Pick<CreateApiTokenInput, 'expiresInDays'>>

export function useApiTokens(enabled = true) {
  return useQuery({
    queryKey: MY_TOKENS_KEY,
    queryFn: () =>
      apiFetch<ApiTokenDTO[]>(
        BASE_API_ROUTE,
        undefined,
        'Erro ao carregar os tokens de API',
      ),
    enabled,
  })
}

export function useApiTokenWorkspaces(enabled = true) {
  return useQuery({
    queryKey: [...API_TOKENS_KEY, 'workspaces'],
    queryFn: () =>
      apiFetch<ApiTokenWorkspaceOptionDTO[]>(
        `${BASE_API_ROUTE}/workspaces`,
        undefined,
        'Erro ao carregar os workspaces',
      ),
    enabled,
  })
}

export function useCreateApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateApiTokenRequest) =>
      apiFetchJson<ApiTokenCreatedDTO>(
        BASE_API_ROUTE,
        'POST',
        input,
        'Erro ao criar o token',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY }),
  })
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<{ id: string }>(
        `${BASE_API_ROUTE}/${encodeURIComponent(id)}`,
        'DELETE',
        undefined,
        'Erro ao revogar o token',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY }),
  })
}

/** Answer of the `/device` page to a `steel login`. */
export function useAuthorizeDevice() {
  return useMutation({
    mutationFn: (input: DeviceAuthorizeInput) =>
      apiFetchJson<DeviceAuthorizeResultDTO>(
        '/api/device/authorize',
        'POST',
        input,
        'Não foi possível concluir o login',
      ),
  })
}
