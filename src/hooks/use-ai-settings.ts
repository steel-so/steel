import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkspaceAiSettingsDTO } from '@/types/ai-settings'
import { apiFetch } from './_fetch'

export const AI_SETTINGS_KEY = (workspaceId: string) =>
  ['ai-settings', workspaceId] as const

export interface UpdateAiSettingsInput {
  enabledModels?: string[]
  crmAssistantModel?: string
  whatsappReplyModel?: string
  whatsappSentimentModel?: string
  monthlyQuotaUsd?: number
  agentModeEnabled?: boolean
  aiEnabled?: boolean
  agentsEnabled?: boolean
  memoryEnabled?: boolean
  autopilotEnabled?: boolean
  usageWeeklyEmailEnabled?: boolean
  mcpWriteEnabled?: boolean
}

export function useAiSettings(workspaceId: string) {
  return useQuery({
    queryKey: AI_SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WorkspaceAiSettingsDTO>(
        `/api/workspaces/${workspaceId}/ai-settings`,
        undefined,
        'Erro ao buscar os ajustes de IA',
      ),
    staleTime: 30 * 1000,
  })
}

export function useUpdateAiSettings(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateAiSettingsInput) =>
      apiFetch<WorkspaceAiSettingsDTO>(
        `/api/workspaces/${workspaceId}/ai-settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar os ajustes de IA',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(AI_SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useSetAiPreference(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (modelKey: string | null) =>
      apiFetch<WorkspaceAiSettingsDTO>(
        `/api/workspaces/${workspaceId}/ai-settings/preference`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelKey }),
        },
        'Erro ao salvar o modelo de IA',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(AI_SETTINGS_KEY(workspaceId), data)
    },
  })
}
