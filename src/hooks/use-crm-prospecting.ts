'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCrmProspectingAgentDTO,
  DecideCrmProspectDraftDTO,
  UpdateCrmProspectDraftDTO,
  UpdateCrmProspectingSettingsDTO,
} from '@/src/schemas/crm-prospecting.schema'
import type {
  CrmProspectDraftDTO,
  CrmProspectDraftStatusDTO,
  CrmProspectingSettingsDTO,
  CrmProspectingUsageDTO,
} from '@/types/crm-prospecting'
import type { SteelAgentDTO } from '@/types/steel-agent'
import { apiFetch, apiFetchJson } from './_fetch'

/** Prospecting agent (T5): switches, quota, agent preset and the draft inbox. */

const base = (ws: string) =>
  `/api/workspaces/${encodeURIComponent(ws)}/crm/prospecting`

export const crmProspectingKeys = {
  all: (ws: string) => ['crm-prospecting', ws] as const,
  settings: (ws: string) => ['crm-prospecting', ws, 'settings'] as const,
  usage: (ws: string) => ['crm-prospecting', ws, 'usage'] as const,
  drafts: (ws: string, status: CrmProspectDraftStatusDTO | 'ALL') =>
    ['crm-prospecting', ws, 'drafts', status] as const,
}

export function useCrmProspectingSettings(workspaceId: string) {
  return useQuery({
    queryKey: crmProspectingKeys.settings(workspaceId),
    queryFn: () =>
      apiFetch<CrmProspectingSettingsDTO>(
        `${base(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar as configurações da prospecção',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useUpdateCrmProspectingSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCrmProspectingSettingsDTO) =>
      apiFetchJson<CrmProspectingSettingsDTO>(
        `${base(workspaceId)}/settings`,
        'PUT',
        input,
        'Erro ao salvar as configurações da prospecção',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmProspectingKeys.all(workspaceId),
      }),
  })
}

export function useCrmProspectingUsage(workspaceId: string) {
  return useQuery({
    queryKey: crmProspectingKeys.usage(workspaceId),
    queryFn: () =>
      apiFetch<CrmProspectingUsageDTO>(
        `${base(workspaceId)}/usage`,
        undefined,
        'Erro ao buscar o consumo da prospecção',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmProspectDrafts(
  workspaceId: string,
  status: CrmProspectDraftStatusDTO | 'ALL',
) {
  const query = status === 'ALL' ? '' : `?status=${status}`
  return useQuery({
    queryKey: crmProspectingKeys.drafts(workspaceId, status),
    queryFn: () =>
      apiFetch<CrmProspectDraftDTO[]>(
        `${base(workspaceId)}/drafts${query}`,
        undefined,
        'Erro ao buscar os rascunhos',
      ),
    enabled: Boolean(workspaceId),
    // The agent keeps writing drafts in the background.
    refetchInterval: 30_000,
  })
}

export function useUpdateCrmProspectDraft(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      draftId,
      ...input
    }: UpdateCrmProspectDraftDTO & { draftId: string }) =>
      apiFetchJson<CrmProspectDraftDTO>(
        `${base(workspaceId)}/drafts/${encodeURIComponent(draftId)}`,
        'PATCH',
        input,
        'Erro ao salvar o rascunho',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmProspectingKeys.all(workspaceId),
      }),
  })
}

export function useDecideCrmProspectDraft(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      draftId,
      ...input
    }: DecideCrmProspectDraftDTO & { draftId: string }) =>
      apiFetchJson<CrmProspectDraftDTO>(
        `${base(workspaceId)}/drafts/${encodeURIComponent(draftId)}/decision`,
        'POST',
        input,
        'Erro ao registrar a decisão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmProspectingKeys.all(workspaceId),
      }),
  })
}

export function useCreateCrmProspectingAgent(workspaceId: string) {
  return useMutation({
    mutationFn: (input: CreateCrmProspectingAgentDTO) =>
      apiFetchJson<SteelAgentDTO>(
        `${base(workspaceId)}/agent`,
        'POST',
        input,
        'Erro ao criar o agente de prospecção',
      ),
  })
}
