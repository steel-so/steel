import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateVoiceAgentRouteDTO,
  UpdateVoiceAgentRouteDTO,
  UpdateVoiceAgentSettingsDTO,
} from '@/src/schemas/voice-agent.schema'
import type {
  VoiceAgentRouteDTO,
  VoiceAgentSecretDTO,
  VoiceAgentSettingsDTO,
  VoiceAgentUsageDTO,
} from '@/types/voice-agent'
import { apiFetch } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['voice-agent-settings', workspaceId] as const
const ROUTES_KEY = (workspaceId: string) =>
  ['voice-agent-routes', workspaceId] as const
const USAGE_KEY = (workspaceId: string) =>
  ['voice-agent-usage', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/voice-agent`

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function useVoiceAgentSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<VoiceAgentSettingsDTO>(
        `${base(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar as configurações do atendente de voz',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useUpdateVoiceAgentSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateVoiceAgentSettingsDTO) =>
      apiFetch<VoiceAgentSettingsDTO>(
        `${base(workspaceId)}/settings`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
        'Erro ao salvar as configurações do atendente de voz',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useRotateVoiceAgentSecret(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<VoiceAgentSecretDTO>(
        `${base(workspaceId)}/secret`,
        { method: 'POST' },
        'Erro ao gerar o segredo do PABX',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY(workspaceId) }),
  })
}

export function useVoiceAgentRoutes(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ROUTES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<VoiceAgentRouteDTO[]>(
        `${base(workspaceId)}/routes`,
        undefined,
        'Erro ao buscar as filas e números do atendente de voz',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useCreateVoiceAgentRoute(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateVoiceAgentRouteDTO) =>
      apiFetch<VoiceAgentRouteDTO>(
        `${base(workspaceId)}/routes`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
        'Erro ao adicionar a fila ou o número',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY(workspaceId) }),
  })
}

export function useUpdateVoiceAgentRoute(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      routeId,
      ...data
    }: UpdateVoiceAgentRouteDTO & { routeId: string }) =>
      apiFetch<VoiceAgentRouteDTO>(
        `${base(workspaceId)}/routes/${routeId}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
        'Erro ao atualizar a fila ou o número',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY(workspaceId) }),
  })
}

export function useDeleteVoiceAgentRoute(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (routeId: string) =>
      apiFetch<{ id: string }>(
        `${base(workspaceId)}/routes/${routeId}`,
        { method: 'DELETE' },
        'Erro ao remover a fila ou o número',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY(workspaceId) }),
  })
}

export function useVoiceAgentUsage(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: USAGE_KEY(workspaceId),
    queryFn: () =>
      apiFetch<VoiceAgentUsageDTO>(
        `${base(workspaceId)}/usage`,
        undefined,
        'Erro ao buscar o uso do atendente de voz',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}
