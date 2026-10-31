'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type {
  AiProcedureCatalogDTO,
  AiProcedureDTO,
  AiProcedurePreviewDTO,
  AiProcedureRunDetailDTO,
  AiProcedureRunDTO,
  AiProcedureStatusDTO,
  AiProcedureVersionDTO,
} from '@/types/ai-procedure'
import { apiFetch } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/ai-procedures`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const AI_PROCEDURES_KEY = (workspaceId: string) =>
  ['ai-procedures', workspaceId] as const

/** Body of create/update (the editor always sends the whole procedure). */
export interface AiProcedureInput {
  name: string
  description: string | null
  whenToUse: string
  status: AiProcedureStatusDTO
  steps: ProcedureStep[]
  maxAttempts: number
  handoffMessage: string | null
  whatsappEnabled: boolean
  agentIds: string[]
  changeNote?: string | null
}

export function useAiProcedures(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'list'],
    queryFn: () =>
      apiFetch<AiProcedureDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os procedimentos',
      ),
  })
}

export function useAiProcedure(workspaceId: string, procedureId: string) {
  return useQuery({
    enabled: Boolean(procedureId),
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'one', procedureId],
    queryFn: () =>
      apiFetch<AiProcedureDTO>(
        `${base(workspaceId)}/${procedureId}`,
        undefined,
        'Erro ao carregar o procedimento',
      ),
  })
}

export function useAiProcedureCatalog(workspaceId: string) {
  return useQuery({
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'catalog'],
    queryFn: () =>
      apiFetch<AiProcedureCatalogDTO>(
        `${base(workspaceId)}/catalog`,
        undefined,
        'Erro ao carregar o catálogo',
      ),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAiProcedureVersions(
  workspaceId: string,
  procedureId: string,
) {
  return useQuery({
    enabled: Boolean(procedureId),
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'versions', procedureId],
    queryFn: () =>
      apiFetch<AiProcedureVersionDTO[]>(
        `${base(workspaceId)}/${procedureId}/versions`,
        undefined,
        'Erro ao carregar as versões',
      ),
  })
}

export function useAiProcedureRuns(workspaceId: string, procedureId: string) {
  return useQuery({
    enabled: Boolean(procedureId),
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'runs', procedureId],
    queryFn: () =>
      apiFetch<AiProcedureRunDTO[]>(
        `${base(workspaceId)}/${procedureId}/runs?limit=50`,
        undefined,
        'Erro ao carregar as execuções',
      ),
  })
}

export function useAiProcedureRun(workspaceId: string, runId: string | null) {
  return useQuery({
    enabled: Boolean(runId),
    queryKey: [...AI_PROCEDURES_KEY(workspaceId), 'run', runId],
    queryFn: () =>
      apiFetch<AiProcedureRunDetailDTO>(
        `${base(workspaceId)}/runs/${runId}`,
        undefined,
        'Erro ao carregar a execução',
      ),
  })
}

export function useCreateAiProcedure(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AiProcedureInput) =>
      apiFetch<AiProcedureDTO>(
        base(workspaceId),
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao criar o procedimento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_PROCEDURES_KEY(workspaceId),
      }),
  })
}

export function useUpdateAiProcedure(workspaceId: string, procedureId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AiProcedureInput>) =>
      apiFetch<AiProcedureDTO>(
        `${base(workspaceId)}/${procedureId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) },
        'Erro ao salvar o procedimento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_PROCEDURES_KEY(workspaceId),
      }),
  })
}

export function useDeleteAiProcedure(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (procedureId: string) =>
      apiFetch<AiProcedureDTO>(
        `${base(workspaceId)}/${procedureId}`,
        { method: 'DELETE' },
        'Erro ao excluir o procedimento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_PROCEDURES_KEY(workspaceId),
      }),
  })
}

export function useRestoreAiProcedureVersion(
  workspaceId: string,
  procedureId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) =>
      apiFetch<AiProcedureDTO>(
        `${base(workspaceId)}/${procedureId}/versions/${versionId}/restore`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({}) },
        'Erro ao restaurar a versão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_PROCEDURES_KEY(workspaceId),
      }),
  })
}

export function usePreviewAiProcedure(workspaceId: string, procedureId: string) {
  return useMutation({
    mutationFn: (variables: Record<string, string>) =>
      apiFetch<AiProcedurePreviewDTO>(
        `${base(workspaceId)}/${procedureId}/preview`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ variables }),
        },
        'Erro ao pré-visualizar',
      ),
  })
}
