'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlatformFlagDTO, PlatformFlagWorkspaceDTO } from '@/types/platform-flag'
import { apiFetch } from './_fetch'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const platformFlagKeys = {
  all: ['admin', 'platform-flags'] as const,
  workspaces: (search: string, flagId?: string) =>
    ['admin', 'platform-flags', 'workspaces', search, flagId ?? ''] as const,
  active: (workspaceId: string) =>
    ['workspace', workspaceId, 'platform-flags'] as const,
}

/** Chaves das flags ativas do workspace atual (cliente). */
export function useActivePlatformFlags(workspaceId: string | undefined) {
  return useQuery({
    queryKey: platformFlagKeys.active(workspaceId ?? ''),
    queryFn: () =>
      apiFetch<string[]>(
        `/api/workspaces/${workspaceId}/flags`,
        undefined,
        'Erro ao carregar as flags do workspace',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

/** Uma flag específica; `false` enquanto carrega ou se a leitura falhar. */
export function usePlatformFlag(workspaceId: string | undefined, key: string) {
  const { data, isLoading } = useActivePlatformFlags(workspaceId)
  return { enabled: data?.includes(key) ?? false, isLoading }
}

export function useAdminPlatformFlags() {
  return useQuery({
    queryKey: platformFlagKeys.all,
    queryFn: () =>
      apiFetch<PlatformFlagDTO[]>(
        '/api/admin/feature-flags',
        undefined,
        'Erro ao carregar as feature flags',
      ),
  })
}

export function useAdminFlagWorkspaces(search: string, flagId?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (flagId) params.set('flagId', flagId)
  const qs = params.toString()
  return useQuery({
    queryKey: platformFlagKeys.workspaces(search, flagId),
    queryFn: () =>
      apiFetch<PlatformFlagWorkspaceDTO[]>(
        `/api/admin/feature-flags/workspaces${qs ? `?${qs}` : ''}`,
        undefined,
        'Erro ao carregar os workspaces',
      ),
  })
}

function useInvalidate() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: platformFlagKeys.all })
}

export function useCreatePlatformFlag() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      key: string
      name: string
      description?: string | null
      enabled?: boolean
      betaEnabled?: boolean
    }) =>
      apiFetch<PlatformFlagDTO>(
        '/api/admin/feature-flags',
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
        'Erro ao criar a flag',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdatePlatformFlag() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string
      name?: string
      description?: string | null
      enabled?: boolean
      betaEnabled?: boolean
    }) =>
      apiFetch<PlatformFlagDTO>(
        `/api/admin/feature-flags/${id}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
        'Erro ao salvar a flag',
      ),
    onSuccess: invalidate,
  })
}

export function useDeletePlatformFlag() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(
        `/api/admin/feature-flags/${id}`,
        { method: 'DELETE' },
        'Erro ao excluir a flag',
      ),
    onSuccess: invalidate,
  })
}

export function useSetFlagWorkspace(flagId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { workspaceId: string; granted: boolean }) =>
      apiFetch<PlatformFlagDTO>(
        `/api/admin/feature-flags/${flagId}/workspaces`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
        'Erro ao salvar a liberação',
      ),
    onSuccess: invalidate,
  })
}

export function useSetWorkspaceBeta() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { workspaceId: string; beta: boolean }) =>
      apiFetch<PlatformFlagWorkspaceDTO>(
        '/api/admin/feature-flags/workspaces',
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
        'Erro ao salvar o workspace beta',
      ),
    onSuccess: invalidate,
  })
}
