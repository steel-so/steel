'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AiEvalRunReason,
  AiEvalTargetKey,
} from '@/src/lib/ai/quality-labels'
import type {
  AiEvalCaseDTO,
  AiEvalRunDetailDTO,
  AiEvalRunDTO,
  AiEvalSetDetailDTO,
  AiEvalSetDTO,
} from '@/types/ai-quality'
import { apiFetch, apiSend } from './_fetch'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai/evals`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const AI_EVALS_KEY = (workspaceId: string) =>
  ['ai-evals', workspaceId] as const

export interface AiEvalSetInput {
  name?: string
  description?: string | null
  target?: AiEvalTargetKey
  skillId?: string | null
}

export interface AiEvalCaseInput {
  input?: string
  expected?: string | null
  criteria?: string | null
  mustContain?: string[]
  mustNotContain?: string[]
}

export interface AiEvalRunInput {
  modelKey?: string | null
  skillId?: string | null
  promptOverride?: string | null
  reason?: AiEvalRunReason
}

function send<T>(url: string, method: string, body: unknown, error: string) {
  return apiFetch<T>(
    url,
    { method, headers: JSON_HEADERS, body: JSON.stringify(body) },
    error,
  )
}

/** A run still QUEUED/RUNNING is polled until it finishes. */
function isActive(run: AiEvalRunDTO | null | undefined): boolean {
  return run?.status === 'QUEUED' || run?.status === 'RUNNING'
}

export function useAiEvalSets(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: [...AI_EVALS_KEY(workspaceId), 'sets'],
    queryFn: () =>
      apiFetch<AiEvalSetDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os conjuntos de teste',
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((set) => isActive(set.lastRun)) ? 3000 : false,
  })
}

export function useAiEvalSet(workspaceId: string, setId: string) {
  return useQuery({
    queryKey: [...AI_EVALS_KEY(workspaceId), 'set', setId],
    queryFn: () =>
      apiFetch<AiEvalSetDetailDTO>(
        `${base(workspaceId)}/${encodeURIComponent(setId)}`,
        undefined,
        'Erro ao carregar o conjunto de teste',
      ),
    refetchInterval: (query) =>
      isActive(query.state.data?.lastRun) ? 3000 : false,
  })
}

export function useAiEvalRuns(workspaceId: string, setId: string) {
  return useQuery({
    queryKey: [...AI_EVALS_KEY(workspaceId), 'runs', setId],
    queryFn: () =>
      apiFetch<AiEvalRunDTO[]>(
        `${base(workspaceId)}/${encodeURIComponent(setId)}/runs`,
        undefined,
        'Erro ao carregar as execuções',
      ),
    refetchInterval: (query) =>
      query.state.data?.some(isActive) ? 3000 : false,
  })
}

export function useAiEvalRun(
  workspaceId: string,
  setId: string,
  runId: string | null,
) {
  return useQuery({
    queryKey: [...AI_EVALS_KEY(workspaceId), 'run', runId],
    queryFn: () =>
      apiFetch<AiEvalRunDetailDTO>(
        `${base(workspaceId)}/${encodeURIComponent(setId)}/runs/${encodeURIComponent(runId ?? '')}`,
        undefined,
        'Erro ao carregar a execução',
      ),
    enabled: Boolean(runId),
    refetchInterval: (query) => (isActive(query.state.data) ? 3000 : false),
  })
}

/** Sets of a target with their last finished run (settings guards). */
export function useLatestAiEvals(
  workspaceId: string,
  target: AiEvalTargetKey,
  enabled = true,
) {
  return useQuery({
    queryKey: [...AI_EVALS_KEY(workspaceId), 'latest', target],
    queryFn: () =>
      apiFetch<AiEvalSetDTO[]>(
        `${base(workspaceId)}/latest?target=${target}`,
        undefined,
        'Erro ao carregar as avaliações',
      ),
    enabled,
    retry: false,
    staleTime: 30 * 1000,
  })
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: AI_EVALS_KEY(workspaceId) })
}

export function useCreateAiEvalSet(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: AiEvalSetInput) =>
      send<AiEvalSetDTO>(
        base(workspaceId),
        'POST',
        input,
        'Não foi possível criar o conjunto',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateAiEvalSet(workspaceId: string, setId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: AiEvalSetInput) =>
      send<AiEvalSetDTO>(
        `${base(workspaceId)}/${encodeURIComponent(setId)}`,
        'PATCH',
        input,
        'Não foi possível salvar o conjunto',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteAiEvalSet(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (setId: string) =>
      apiSend(
        `${base(workspaceId)}/${encodeURIComponent(setId)}`,
        { method: 'DELETE' },
        'Não foi possível excluir o conjunto',
      ),
    onSuccess: invalidate,
  })
}

export function useSaveAiEvalCase(workspaceId: string, setId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({ id, ...input }: AiEvalCaseInput & { id?: string }) =>
      id
        ? send<AiEvalCaseDTO>(
            `${base(workspaceId)}/${encodeURIComponent(setId)}/cases/${encodeURIComponent(id)}`,
            'PATCH',
            input,
            'Não foi possível salvar o caso',
          )
        : send<AiEvalCaseDTO>(
            `${base(workspaceId)}/${encodeURIComponent(setId)}/cases`,
            'POST',
            input,
            'Não foi possível adicionar o caso',
          ),
    onSuccess: invalidate,
  })
}

export function useDeleteAiEvalCase(workspaceId: string, setId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (caseId: string) =>
      apiSend(
        `${base(workspaceId)}/${encodeURIComponent(setId)}/cases/${encodeURIComponent(caseId)}`,
        { method: 'DELETE' },
        'Não foi possível excluir o caso',
      ),
    onSuccess: invalidate,
  })
}

/** "Salvar como caso de teste" from a Steel AI answer. */
export function useSaveAiEvalCaseFromMessage(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: {
      setId: string
      messageId: string
      criteria?: string | null
    }) =>
      send<AiEvalCaseDTO>(
        `${base(workspaceId)}/cases/from-message`,
        'POST',
        input,
        'Não foi possível salvar o caso de teste',
      ),
    onSuccess: invalidate,
  })
}

export function useStartAiEvalRun(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({ setId, ...input }: AiEvalRunInput & { setId: string }) =>
      send<AiEvalRunDTO>(
        `${base(workspaceId)}/${encodeURIComponent(setId)}/runs`,
        'POST',
        input,
        'Não foi possível iniciar a avaliação',
      ),
    onSuccess: invalidate,
  })
}
