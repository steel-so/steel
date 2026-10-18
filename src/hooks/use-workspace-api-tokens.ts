import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkspaceApiTokenDTO } from '@/types/api-token'
import { apiFetch, apiFetchJson } from './_fetch'
import { API_TOKENS_KEY } from './use-api-tokens'

/** Ajustes › Apps conectados › Tokens de API (OWNER/ADMIN). */

export const workspaceApiTokensKey = (workspaceId: string) =>
  [...API_TOKENS_KEY, 'workspace', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/api-tokens`

export function useWorkspaceApiTokens(workspaceId: string) {
  return useQuery({
    queryKey: workspaceApiTokensKey(workspaceId),
    queryFn: () =>
      apiFetch<WorkspaceApiTokenDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os tokens de API',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useRevokeWorkspaceApiToken(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetchJson<{ id: string }>(
        `${base(workspaceId)}/${encodeURIComponent(tokenId)}`,
        'DELETE',
        undefined,
        'Erro ao revogar o token',
      ),
    // The admin may have revoked their own token too.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY }),
  })
}
