'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmNewsletterAbReportDTO,
  CrmNewsletterAbTestDTO,
  SetCrmNewsletterAbTestDTO,
} from '@/src/schemas/crm-newsletter-ab.schema'
import type {
  CrmNewsletterAiDraftDTO,
  CrmNewsletterAiDraftResultDTO,
  CrmNewsletterAiSourcesDTO,
  CrmNewsletterAiSubjectsDTO,
  CrmNewsletterAiSubjectsResultDTO,
} from '@/src/schemas/crm-newsletter-ai.schema'
import type {
  CrmNewsletterDigestPreviewDTO,
  CrmNewsletterDigestRunDTO,
  CrmNewsletterDigestSettingsDTO,
  PreviewCrmNewsletterDigestDTO,
  UpsertCrmNewsletterDigestDTO,
} from '@/src/schemas/crm-newsletter-digest.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'
import { crmNewsletterIssueKeys } from './use-crm-newsletter-issues'

/**
 * Newsletter phase 2, slice nl2-digest-ai: the "Resumo automático" tab,
 * the AI actions of the issue editor and the subject A/B test.
 */

const newsletterBase = (ws: string, newsletterId: string) =>
  `/api/workspaces/${ws}/crm/newsletters/${newsletterId}`

export const crmNewsletterDigestAiKeys = {
  digest: (ws: string, newsletterId: string) =>
    ['crm-newsletter-digest', ws, newsletterId] as const,
  aiSources: (ws: string, newsletterId: string) =>
    ['crm-newsletter-ai-sources', ws, newsletterId] as const,
  abTest: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-issues', ws, newsletterId, 'ab-test', issueId] as const,
}

// ─── digest ────────────────────────────────────────────────────────────────

export function useCrmNewsletterDigest(
  workspaceId: string,
  newsletterId: string,
) {
  return useQuery({
    queryKey: crmNewsletterDigestAiKeys.digest(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterDigestSettingsDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/digest`,
        undefined,
        'Erro ao buscar o resumo automático',
      ),
  })
}

export function useSaveCrmNewsletterDigest(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertCrmNewsletterDigestDTO) =>
      apiFetchJson<CrmNewsletterDigestSettingsDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/digest`,
        'PUT',
        input,
        'Erro ao salvar o resumo automático',
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(
        crmNewsletterDigestAiKeys.digest(workspaceId, newsletterId),
        data,
      ),
  })
}

export function useDeleteCrmNewsletterDigest(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiSend(
        `${newsletterBase(workspaceId, newsletterId)}/digest`,
        { method: 'DELETE' },
        'Erro ao remover o resumo automático',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterDigestAiKeys.digest(workspaceId, newsletterId),
      }),
  })
}

export function usePreviewCrmNewsletterDigest(
  workspaceId: string,
  newsletterId: string,
) {
  return useMutation({
    mutationFn: (input: PreviewCrmNewsletterDigestDTO) =>
      apiFetchJson<CrmNewsletterDigestPreviewDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/digest/preview`,
        'POST',
        input,
        'Erro ao ler as fontes do resumo',
      ),
  })
}

export function useRunCrmNewsletterDigest(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<CrmNewsletterDigestRunDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/digest/run`,
        'POST',
        undefined,
        'Erro ao gerar o resumo',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.all(workspaceId, newsletterId),
      }),
  })
}

// ─── AI in the issue editor ────────────────────────────────────────────────

export function useCrmNewsletterAiSources(
  workspaceId: string,
  newsletterId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmNewsletterDigestAiKeys.aiSources(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterAiSourcesDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/ai/sources`,
        undefined,
        'Erro ao buscar as fontes',
      ),
    enabled,
    staleTime: 60_000,
  })
}

export function useCrmNewsletterAiDraft(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  return useMutation({
    mutationFn: (input: CrmNewsletterAiDraftDTO) =>
      apiFetchJson<CrmNewsletterAiDraftResultDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/ai/draft`,
        'POST',
        input,
        'A IA não conseguiu escrever a edição',
      ),
  })
}

export function useCrmNewsletterAiSubjects(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  return useMutation({
    mutationFn: (input: CrmNewsletterAiSubjectsDTO) =>
      apiFetchJson<CrmNewsletterAiSubjectsResultDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/ai/subjects`,
        'POST',
        input,
        'A IA não conseguiu sugerir assuntos',
      ),
  })
}

// ─── subject A/B test ──────────────────────────────────────────────────────

export function useCrmNewsletterAbTest(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  live = false,
) {
  return useQuery({
    queryKey: crmNewsletterDigestAiKeys.abTest(
      workspaceId,
      newsletterId,
      issueId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterAbReportDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/ab-test`,
        undefined,
        'Erro ao buscar o teste A/B',
      ),
    refetchInterval: live ? 30_000 : false,
  })
}

export function useSaveCrmNewsletterAbTest(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: crmNewsletterDigestAiKeys.abTest(
        workspaceId,
        newsletterId,
        issueId,
      ),
    })
  const url = `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/ab-test`
  const save = useMutation({
    mutationFn: (input: SetCrmNewsletterAbTestDTO) =>
      apiFetchJson<CrmNewsletterAbTestDTO>(
        url,
        'PUT',
        input,
        'Erro ao salvar o teste A/B',
      ),
    onSuccess: invalidate,
  })
  const clear = useMutation({
    mutationFn: () =>
      apiSend(url, { method: 'DELETE' }, 'Erro ao desligar o teste A/B'),
    onSuccess: invalidate,
  })
  return { save, clear }
}
