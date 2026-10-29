'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SteelAgentAssignmentDTO,
  SteelAgentAssignmentEntityDTO,
} from '@/types/steel-agent'
import { apiFetch, apiFetchJson } from './_fetch'

/** Route of the "Atribuir ao agente" endpoint of a ticket or lead. */
export function steelAgentAssignmentUrl(
  workspaceId: string,
  entityType: SteelAgentAssignmentEntityDTO,
  ref: string,
): string {
  const segment =
    entityType === 'SD_TICKET'
      ? `servicedesk/tickets/${encodeURIComponent(ref)}`
      : `crm/leads/${encodeURIComponent(ref)}`
  return `/api/workspaces/${workspaceId}/${segment}/agent`
}

const assignmentKey = (
  workspaceId: string,
  entityType: SteelAgentAssignmentEntityDTO,
  ref: string,
) => ['steel-agent-assignment', workspaceId, entityType, ref] as const

/** Agent a ticket or lead is currently assigned to. */
export function useSteelAgentAssignment(
  workspaceId: string,
  entityType: SteelAgentAssignmentEntityDTO,
  ref: string,
  enabled = true,
) {
  return useQuery({
    queryKey: assignmentKey(workspaceId, entityType, ref),
    queryFn: () =>
      apiFetch<SteelAgentAssignmentDTO>(
        steelAgentAssignmentUrl(workspaceId, entityType, ref),
        undefined,
        'Erro ao carregar o agente atribuído',
      ),
    enabled: enabled && Boolean(ref),
  })
}

/** Hands the record to an agent (`agentId: null` removes it). */
export function useAssignSteelAgent(
  workspaceId: string,
  entityType: SteelAgentAssignmentEntityDTO,
  ref: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string | null) =>
      apiFetchJson<SteelAgentAssignmentDTO>(
        steelAgentAssignmentUrl(workspaceId, entityType, ref),
        'PUT',
        { agentId },
        'Erro ao atribuir o agente',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        assignmentKey(workspaceId, entityType, ref),
        data,
      )
      // The new run shows up in the agent's history.
      void queryClient.invalidateQueries({
        queryKey: ['steel-agents', workspaceId],
      })
    },
  })
}
