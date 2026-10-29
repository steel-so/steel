'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSteelAgentSimulationDTO,
  GenerateSteelAgentScenariosDTO,
} from '@/src/schemas/steel-agent-simulation.schema'
import type {
  SteelAgentSimulationDetailDTO,
  SteelAgentSimulationDTO,
  SteelAgentSimulationScenarioDraftDTO,
} from '@/types/steel-agent-simulation'
import { apiFetch } from './_fetch'

const base = (workspaceId: string, agentId: string) =>
  `/api/workspaces/${workspaceId}/agents/${agentId}/simulations`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const STEEL_AGENT_SIMULATIONS_KEY = (
  workspaceId: string,
  agentId: string,
) => ['steel-agents', workspaceId, 'simulations', agentId] as const
const SIMULATION_KEY = (
  workspaceId: string,
  agentId: string,
  simulationId: string,
) =>
  [
    ...STEEL_AGENT_SIMULATIONS_KEY(workspaceId, agentId),
    'detail',
    simulationId,
  ] as const

/** Simulations that will change on their own (poll while visible). */
const LIVE = new Set(['QUEUED', 'RUNNING'])

export function useSteelAgentSimulations(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: [...STEEL_AGENT_SIMULATIONS_KEY(workspaceId, agentId), 'list'],
    queryFn: () =>
      apiFetch<SteelAgentSimulationDTO[]>(
        `${base(workspaceId, agentId)}?limit=50`,
        undefined,
        'Erro ao carregar as simulações',
      ),
    refetchInterval: (query) =>
      query.state.data?.some((item) => LIVE.has(item.status)) ? 3_000 : false,
  })
}

export function useSteelAgentSimulation(
  workspaceId: string,
  agentId: string,
  simulationId: string,
) {
  return useQuery({
    queryKey: SIMULATION_KEY(workspaceId, agentId, simulationId),
    queryFn: () =>
      apiFetch<SteelAgentSimulationDetailDTO>(
        `${base(workspaceId, agentId)}/${simulationId}`,
        undefined,
        'Erro ao carregar a simulação',
      ),
    refetchInterval: (query) =>
      query.state.data && LIVE.has(query.state.data.status) ? 3_000 : false,
  })
}

export function useCreateSteelAgentSimulation(
  workspaceId: string,
  agentId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSteelAgentSimulationDTO) =>
      apiFetch<SteelAgentSimulationDTO>(
        base(workspaceId, agentId),
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao iniciar a simulação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENT_SIMULATIONS_KEY(workspaceId, agentId),
      }),
  })
}

export function useGenerateSteelAgentScenarios(
  workspaceId: string,
  agentId: string,
) {
  return useMutation({
    mutationFn: (data: Partial<GenerateSteelAgentScenariosDTO>) =>
      apiFetch<SteelAgentSimulationScenarioDraftDTO[]>(
        `${base(workspaceId, agentId)}/generate`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao gerar os cenários',
      ),
  })
}

export function useRerunSteelAgentSimulation(
  workspaceId: string,
  agentId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (simulationId: string) =>
      apiFetch<SteelAgentSimulationDTO>(
        `${base(workspaceId, agentId)}/${simulationId}/rerun`,
        { method: 'POST' },
        'Erro ao repetir a simulação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENT_SIMULATIONS_KEY(workspaceId, agentId),
      }),
  })
}

export function useDeleteSteelAgentSimulation(
  workspaceId: string,
  agentId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (simulationId: string) =>
      apiFetch<SteelAgentSimulationDTO>(
        `${base(workspaceId, agentId)}/${simulationId}`,
        { method: 'DELETE' },
        'Erro ao excluir a simulação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENT_SIMULATIONS_KEY(workspaceId, agentId),
      }),
  })
}
