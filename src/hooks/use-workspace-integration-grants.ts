import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  IntegrationGrantRevokeManyDTO,
  WorkspaceIntegrationGrantsDTO,
} from '@/types/integration-grant'
import { apiFetch, apiFetchJson } from './_fetch'

/** Ajustes › Apps conectados (OWNER/ADMIN): every member's MCP grants. */

export const workspaceIntegrationGrantsKey = (workspaceId: string) =>
  ['integration-grants', 'workspace', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/integration-grants`

export function useWorkspaceIntegrationGrants(workspaceId: string) {
  return useQuery({
    queryKey: workspaceIntegrationGrantsKey(workspaceId),
    queryFn: () =>
      apiFetch<WorkspaceIntegrationGrantsDTO>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os apps conectados',
      ),
    enabled: Boolean(workspaceId),
  })
}

/** What to revoke: one grant, all of a member's, or all of an app's. */
export type WorkspaceGrantRevocation =
  | { kind: 'grant'; grantId: string }
  | { kind: 'member'; userId: string }
  | { kind: 'client'; clientId: string }

export function workspaceGrantRevocationPath(
  workspaceId: string,
  target: WorkspaceGrantRevocation,
): string {
  switch (target.kind) {
    case 'grant':
      return `${base(workspaceId)}/${encodeURIComponent(target.grantId)}`
    case 'member':
      return `${base(workspaceId)}/members/${encodeURIComponent(target.userId)}`
    case 'client':
      return `${base(workspaceId)}/clients/${encodeURIComponent(target.clientId)}`
  }
}

export function useRevokeWorkspaceIntegrationGrants(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (target: WorkspaceGrantRevocation) =>
      apiFetchJson<{ id: string } | IntegrationGrantRevokeManyDTO>(
        workspaceGrantRevocationPath(workspaceId, target),
        'DELETE',
        undefined,
        'Erro ao revogar o acesso',
      ),
    onSuccess: () => {
      // The admin may have revoked their own grant too.
      return queryClient.invalidateQueries({ queryKey: ['integration-grants'] })
    },
  })
}
