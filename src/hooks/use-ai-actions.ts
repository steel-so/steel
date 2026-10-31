'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AiActionConnectorDTO,
  AiActionConnectorsDTO,
  AiActionSettingsDTO,
} from '@/types/ai-action'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

export const AI_ACTIONS_KEY = (workspaceId: string) =>
  ['ai-actions', workspaceId] as const

export interface AiActionConnectorInput {
  key: string
  name: string
  description: string
  kind: 'LOOKUP' | 'ACTION'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  urlTemplate: string
  params: { name: string; description: string; required: boolean }[]
  headers: Record<string, string>
  enabled: boolean
}

/** Connectors and switches of the AI actions (OWNER/ADMIN). */
export function useAiActions(workspaceId: string) {
  return useQuery({
    queryKey: AI_ACTIONS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<AiActionConnectorsDTO>(
        `${base(workspaceId)}/connectors`,
        undefined,
        'Erro ao carregar as ações da IA',
      ),
  })
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: AI_ACTIONS_KEY(workspaceId) })
}

export function useCreateAiActionConnector(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: AiActionConnectorInput) =>
      apiFetchJson<AiActionConnectorDTO>(
        `${base(workspaceId)}/connectors`,
        'POST',
        data,
        'Erro ao criar o conector',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateAiActionConnector(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<Omit<AiActionConnectorInput, 'key'>>
    }) =>
      apiFetchJson<AiActionConnectorDTO>(
        `${base(workspaceId)}/connectors/${id}`,
        'PATCH',
        data,
        'Erro ao salvar o conector',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteAiActionConnector(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<true>(
        `${base(workspaceId)}/connectors/${id}`,
        { method: 'DELETE' },
        'Erro ao excluir o conector',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateAiActionSettings(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: Partial<AiActionSettingsDTO>) =>
      apiFetchJson<AiActionSettingsDTO>(
        `${base(workspaceId)}/action-settings`,
        'PATCH',
        data,
        'Erro ao salvar os ajustes das ações da IA',
      ),
    onSuccess: invalidate,
  })
}
