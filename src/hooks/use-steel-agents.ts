'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApproveSteelAgentActionDTO } from '@/src/schemas/steel-agent.schema'
import type { WorkspaceMemberDTO } from '@/types/membership'
import type {
  SteelAgentCatalogDTO,
  SteelAgentDTO,
  SteelAgentRunDetailDTO,
  SteelAgentRunDTO,
  SteelAgentToolModeDTO,
  SteelAgentTriggerTypeDTO,
} from '@/types/steel-agent'
import type { AiPendingActionDTO } from '@/types/steel-ai'
import { apiFetch } from './_fetch'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/agents`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const STEEL_AGENTS_KEY = (workspaceId: string) =>
  ['steel-agents', workspaceId] as const
const AGENT_KEY = (workspaceId: string, agentId: string) =>
  [...STEEL_AGENTS_KEY(workspaceId), 'agent', agentId] as const
const RUNS_KEY = (workspaceId: string, agentId: string) =>
  [...STEEL_AGENTS_KEY(workspaceId), 'runs', agentId] as const
const RUN_KEY = (workspaceId: string, runId: string) =>
  [...STEEL_AGENTS_KEY(workspaceId), 'run', runId] as const

/** Body of create (the editor always sends the full agent). */
export interface SteelAgentInput {
  name: string
  description: string | null
  instructions: string
  triggerType: SteelAgentTriggerTypeDTO
  cron: string | null
  timezone: string
  eventKey: string | null
  enabled: boolean
  ownerId: string
  maxToolRounds: number
  monthlyRunCap: number | null
  tools: { toolName: string; mode: SteelAgentToolModeDTO }[]
}

/** Run states that will change on their own (poll while visible). */
const LIVE = new Set(['QUEUED', 'RUNNING'])

export function useSteelAgents(workspaceId: string) {
  return useQuery({
    queryKey: [...STEEL_AGENTS_KEY(workspaceId), 'list'],
    queryFn: () =>
      apiFetch<SteelAgentDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os agentes',
      ),
  })
}

export function useSteelAgent(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: AGENT_KEY(workspaceId, agentId),
    queryFn: () =>
      apiFetch<SteelAgentDTO>(
        `${base(workspaceId)}/${agentId}`,
        undefined,
        'Erro ao carregar o agente',
      ),
    enabled: Boolean(agentId),
  })
}

export function useSteelAgentCatalog(workspaceId: string) {
  return useQuery({
    queryKey: [...STEEL_AGENTS_KEY(workspaceId), 'catalog'],
    queryFn: () =>
      apiFetch<SteelAgentCatalogDTO>(
        `${base(workspaceId)}/catalog`,
        undefined,
        'Erro ao carregar as ferramentas',
      ),
    staleTime: 5 * 60 * 1000,
  })
}

/** Owner picker (privileged users can always list members). */
export function useSteelAgentMembers(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: [...STEEL_AGENTS_KEY(workspaceId), 'members'],
    queryFn: () =>
      apiFetch<WorkspaceMemberDTO[]>(
        `/api/workspaces/${workspaceId}/members`,
        undefined,
        'Erro ao carregar os membros',
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSteelAgentRuns(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: RUNS_KEY(workspaceId, agentId),
    queryFn: () =>
      apiFetch<SteelAgentRunDTO[]>(
        `${base(workspaceId)}/${agentId}/runs?limit=50`,
        undefined,
        'Erro ao carregar as execuções',
      ),
    refetchInterval: (query) =>
      query.state.data?.some((run) => LIVE.has(run.status)) ? 3_000 : false,
  })
}

export function useSteelAgentRun(
  workspaceId: string,
  agentId: string,
  runId: string,
) {
  return useQuery({
    queryKey: RUN_KEY(workspaceId, runId),
    queryFn: () =>
      apiFetch<SteelAgentRunDetailDTO>(
        `${base(workspaceId)}/${agentId}/runs/${runId}`,
        undefined,
        'Erro ao carregar a execução',
      ),
    refetchInterval: (query) =>
      query.state.data && LIVE.has(query.state.data.status) ? 3_000 : false,
  })
}

export function useCreateSteelAgent(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: SteelAgentInput) =>
      apiFetch<SteelAgentDTO>(
        base(workspaceId),
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao criar o agente',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      }),
  })
}

export function useUpdateSteelAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<SteelAgentInput>) =>
      apiFetch<SteelAgentDTO>(
        `${base(workspaceId)}/${agentId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao salvar o agente',
      ),
    onSuccess: (agent) => {
      queryClient.setQueryData(AGENT_KEY(workspaceId, agentId), agent)
      return queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      })
    },
  })
}

export function useDeleteSteelAgent(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) =>
      apiFetch<SteelAgentDTO>(
        `${base(workspaceId)}/${agentId}`,
        { method: 'DELETE' },
        'Erro ao excluir o agente',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      }),
  })
}

export function useRunSteelAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<SteelAgentRunDTO>(
        `${base(workspaceId)}/${agentId}/run`,
        { method: 'POST' },
        'Erro ao executar o agente',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      }),
  })
}

/** "Testar agente": a run whose writes are only simulated. */
export function useTestSteelAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<SteelAgentRunDTO>(
        `${base(workspaceId)}/${agentId}/test`,
        { method: 'POST' },
        'Erro ao testar o agente',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      }),
  })
}

/** "Reexecutar como teste": replays the input of a past run, writes simulated. */
export function useRerunSteelAgentRunAsTest(
  workspaceId: string,
  agentId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch<SteelAgentRunDTO>(
        `${base(workspaceId)}/${agentId}/runs/${runId}/rerun`,
        { method: 'POST' },
        'Erro ao reexecutar como teste',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AGENTS_KEY(workspaceId),
      }),
  })
}

export function useDecideSteelAgentAction(workspaceId: string, runId: string) {
  const queryClient = useQueryClient()
  const url = (actionId: string, decision: 'approve' | 'reject') =>
    `${base(workspaceId)}/runs/${runId}/actions/${actionId}/${decision}`
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: STEEL_AGENTS_KEY(workspaceId) })

  const approve = useMutation({
    mutationFn: ({
      actionId,
      ...body
    }: ApproveSteelAgentActionDTO & { actionId: string }) =>
      apiFetch<AiPendingActionDTO>(
        url(actionId, 'approve'),
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
        'Erro ao aprovar a ação',
      ),
    // Also on error: a refused approval (AI_PENDING_ACTION_CHANGED) leaves
    // the action pending with a fresh preview that the screen must show.
    onSettled: refresh,
  })
  const reject = useMutation({
    mutationFn: (actionId: string) =>
      apiFetch<AiPendingActionDTO>(
        url(actionId, 'reject'),
        { method: 'POST' },
        'Erro ao rejeitar a ação',
      ),
    onSuccess: refresh,
  })
  return { approve, reject }
}
