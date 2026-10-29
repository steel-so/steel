'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  CreateCrmNewsletterWelcomeStepDTO,
  CrmNewsletterReengagementDTO,
  CrmNewsletterReengagementPreviewDTO,
  CrmNewsletterWelcomeStepDTO,
  UpdateCrmNewsletterReengagementDTO,
  UpdateCrmNewsletterWelcomeStepDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Newsletter automation (newsletter2, nl2-automation): the welcome series
 * ("Boas-vindas" tab and its editor) and the re-engagement section of
 * Configurações.
 */

const base = (ws: string, newsletterId: string) =>
  `/api/workspaces/${ws}/crm/newsletters/${newsletterId}`

export const crmNewsletterAutomationKeys = {
  steps: (ws: string, newsletterId: string) =>
    ['crm-newsletter-welcome', ws, newsletterId] as const,
  step: (ws: string, newsletterId: string, stepId: string) =>
    ['crm-newsletter-welcome', ws, newsletterId, stepId] as const,
  reengagement: (ws: string, newsletterId: string) =>
    ['crm-newsletter-reengagement', ws, newsletterId] as const,
  preview: (
    ws: string,
    newsletterId: string,
    minIssues: number,
    inactiveDays: number,
  ) =>
    [
      'crm-newsletter-reengagement',
      ws,
      newsletterId,
      'preview',
      minIssues,
      inactiveDays,
    ] as const,
}

// ─── Welcome series ──────────────────────────────────────────────────────────

export function useCrmNewsletterWelcomeSteps(
  workspaceId: string,
  newsletterId: string,
) {
  return useQuery({
    queryKey: crmNewsletterAutomationKeys.steps(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterWelcomeStepDTO[]>(
        `${base(workspaceId, newsletterId)}/welcome-steps`,
        undefined,
        'Erro ao buscar a série de boas-vindas',
      ),
  })
}

export function useCrmNewsletterWelcomeStep(
  workspaceId: string,
  newsletterId: string,
  stepId: string,
) {
  return useQuery({
    queryKey: crmNewsletterAutomationKeys.step(
      workspaceId,
      newsletterId,
      stepId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterWelcomeStepDTO>(
        `${base(workspaceId, newsletterId)}/welcome-steps/${stepId}`,
        undefined,
        'Erro ao buscar a etapa',
      ),
  })
}

export function useCreateCrmNewsletterWelcomeStep(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCrmNewsletterWelcomeStepDTO) =>
      apiFetchJson<CrmNewsletterWelcomeStepDTO>(
        `${base(workspaceId, newsletterId)}/welcome-steps`,
        'POST',
        input,
        'Erro ao criar a etapa',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterAutomationKeys.steps(workspaceId, newsletterId),
      }),
  })
}

/** Plain call for the editor autosave (no re-render on start/end). */
export function saveCrmNewsletterWelcomeStep(
  workspaceId: string,
  newsletterId: string,
  stepId: string,
  input: UpdateCrmNewsletterWelcomeStepDTO,
): Promise<CrmNewsletterWelcomeStepDTO> {
  return apiFetchJson<CrmNewsletterWelcomeStepDTO>(
    `${base(workspaceId, newsletterId)}/welcome-steps/${stepId}`,
    'PATCH',
    input,
    'Erro ao salvar a etapa',
  )
}

export function useUpdateCrmNewsletterWelcomeStep(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      stepId,
      ...input
    }: UpdateCrmNewsletterWelcomeStepDTO & { stepId: string }) =>
      saveCrmNewsletterWelcomeStep(workspaceId, newsletterId, stepId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterAutomationKeys.steps(workspaceId, newsletterId),
      }),
  })
}

export function useDeleteCrmNewsletterWelcomeStep(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) =>
      apiSend(
        `${base(workspaceId, newsletterId)}/welcome-steps/${stepId}`,
        { method: 'DELETE' },
        'Erro ao excluir a etapa',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterAutomationKeys.steps(workspaceId, newsletterId),
      }),
  })
}

export function useReorderCrmNewsletterWelcomeSteps(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  const key = crmNewsletterAutomationKeys.steps(workspaceId, newsletterId)
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetchJson<CrmNewsletterWelcomeStepDTO[]>(
        `${base(workspaceId, newsletterId)}/welcome-steps/reorder`,
        'POST',
        { ids },
        'Erro ao reordenar as etapas',
      ),
    onSuccess: (steps) => queryClient.setQueryData(key, steps),
  })
}

// ─── Re-engagement ───────────────────────────────────────────────────────────

export function useCrmNewsletterReengagement(
  workspaceId: string,
  newsletterId: string,
) {
  return useQuery({
    queryKey: crmNewsletterAutomationKeys.reengagement(
      workspaceId,
      newsletterId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterReengagementDTO>(
        `${base(workspaceId, newsletterId)}/reengagement`,
        undefined,
        'Erro ao buscar o reengajamento',
      ),
  })
}

/** Preview with the values being edited (debounced by the caller). */
export function useCrmNewsletterReengagementPreview(
  workspaceId: string,
  newsletterId: string,
  criteria: { minIssues: number; inactiveDays: number } | null,
) {
  return useQuery({
    queryKey: crmNewsletterAutomationKeys.preview(
      workspaceId,
      newsletterId,
      criteria?.minIssues ?? 0,
      criteria?.inactiveDays ?? 0,
    ),
    enabled: criteria !== null,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<CrmNewsletterReengagementPreviewDTO>(
        `${base(workspaceId, newsletterId)}/reengagement/preview?minIssues=${criteria?.minIssues}&inactiveDays=${criteria?.inactiveDays}`,
        undefined,
        'Erro ao calcular a prévia',
      ),
  })
}

export function useSaveCrmNewsletterReengagement(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCrmNewsletterReengagementDTO) =>
      apiFetchJson<CrmNewsletterReengagementDTO>(
        `${base(workspaceId, newsletterId)}/reengagement`,
        'PUT',
        input,
        'Erro ao salvar o reengajamento',
      ),
    onSuccess: (saved) =>
      queryClient.setQueryData(
        crmNewsletterAutomationKeys.reengagement(workspaceId, newsletterId),
        saved,
      ),
  })
}

// ─── Public page ─────────────────────────────────────────────────────────────

/** "Quero continuar recebendo" button of `/newsletter/continuar/<token>`. */
export function reengageNewsletter(token: string) {
  return apiFetchJson<{ newsletterName: string; resubscribed: boolean }>(
    `/api/newsletters/reengage/${encodeURIComponent(token)}`,
    'POST',
    {},
    'Não foi possível confirmar agora. Tente de novo.',
  )
}
