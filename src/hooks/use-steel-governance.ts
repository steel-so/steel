'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SteelAgentPolicyDTO,
  SteelGovernanceDTO,
  SteelKillResultDTO,
} from '@/types/steel-governance'
import type { SteelMcpServerDTO } from '@/types/steel-mcp'
import { apiFetch } from './_fetch'
import { STEEL_AGENTS_KEY } from './use-steel-agents'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/agents`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const GOVERNANCE_KEY = (workspaceId: string, days: number) =>
  [...STEEL_AGENTS_KEY(workspaceId), 'governance', days] as const
const MCP_KEY = (workspaceId: string) =>
  [...STEEL_AGENTS_KEY(workspaceId), 'mcp-servers'] as const

/** Governance panel: inventory, metrics, kill switch and policy (A6/A8). */
export function useSteelGovernance(workspaceId: string, days: number) {
  return useQuery({
    queryKey: GOVERNANCE_KEY(workspaceId, days),
    queryFn: () =>
      apiFetch<SteelGovernanceDTO>(
        `${base(workspaceId)}/governance?days=${days}`,
        undefined,
        'Erro ao carregar a governança dos agentes',
      ),
  })
}

export function steelGovernanceExportUrl(workspaceId: string, days: number) {
  return `${base(workspaceId)}/governance/export?days=${days}`
}

function useInvalidateAgents(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: STEEL_AGENTS_KEY(workspaceId) })
}

export function useKillSteelAgents(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: (reason: string | null) =>
      apiFetch<SteelKillResultDTO>(
        `${base(workspaceId)}/governance/kill`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason }),
        },
        'Erro ao pausar os agentes',
      ),
    onSuccess: invalidate,
  })
}

export function useResumeSteelAgents(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: () =>
      apiFetch<SteelGovernanceDTO['killSwitch']>(
        `${base(workspaceId)}/governance/resume`,
        { method: 'POST' },
        'Erro ao retomar os agentes',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSteelAgentPolicy(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: (data: SteelAgentPolicyDTO) =>
      apiFetch<SteelAgentPolicyDTO>(
        `${base(workspaceId)}/governance/policy`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            restrictCreators: data.restrictCreators,
            creatorRoles: data.creatorRoles,
            restrictAuto: data.restrictAuto,
            autoRules: {
              ADMIN: data.autoRules.ADMIN,
              MEMBER: data.autoRules.MEMBER,
              VIEWER: data.autoRules.VIEWER,
            },
          }),
        },
        'Erro ao salvar as permissões',
      ),
    onSuccess: invalidate,
  })
}

/** External MCP servers of the workspace (OWNER/ADMIN). */
export function useSteelMcpServers(workspaceId: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(workspaceId),
    queryKey: MCP_KEY(workspaceId),
    queryFn: () =>
      apiFetch<SteelMcpServerDTO[]>(
        `${base(workspaceId)}/mcp-servers`,
        undefined,
        'Erro ao carregar os servidores MCP',
      ),
  })
}

export interface SteelMcpServerInput {
  name: string
  url: string
  authHeaderName?: string
  authValue?: string | null
  enabled?: boolean
  allowedTools?: string[]
}

export function useCreateSteelMcpServer(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: (data: SteelMcpServerInput) =>
      apiFetch<SteelMcpServerDTO>(
        `${base(workspaceId)}/mcp-servers`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao adicionar o servidor MCP',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSteelMcpServer(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: ({
      serverId,
      ...data
    }: Partial<SteelMcpServerInput> & { serverId: string }) =>
      apiFetch<SteelMcpServerDTO>(
        `${base(workspaceId)}/mcp-servers/${serverId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao salvar o servidor MCP',
      ),
    onSuccess: invalidate,
  })
}

export function useRefreshSteelMcpServer(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: (serverId: string) =>
      apiFetch<SteelMcpServerDTO>(
        `${base(workspaceId)}/mcp-servers/${serverId}/refresh`,
        { method: 'POST' },
        'Erro ao atualizar as ferramentas',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteSteelMcpServer(workspaceId: string) {
  const invalidate = useInvalidateAgents(workspaceId)
  return useMutation({
    mutationFn: (serverId: string) =>
      apiFetch<SteelMcpServerDTO>(
        `${base(workspaceId)}/mcp-servers/${serverId}`,
        { method: 'DELETE' },
        'Erro ao remover o servidor MCP',
      ),
    onSuccess: invalidate,
  })
}
