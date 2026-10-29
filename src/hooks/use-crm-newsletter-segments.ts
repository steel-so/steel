'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCrmNewsletterSegmentDTO,
  CrmNewsletterAudiencePreviewDTO,
  CrmNewsletterIssueSegmentDTO,
  CrmNewsletterSegmentDTO,
  CrmNewsletterSegmentOptionsDTO,
  NewsletterSegment,
  SetIssueSegmentDTO,
  UpdateCrmNewsletterSegmentDTO,
} from '@/src/schemas/crm-newsletter-segment.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'
import { crmNewsletterIssueKeys } from './use-crm-newsletter-issues'

/**
 * Audience segments of newsletter issues (newsletter2, slice nl2-segments):
 * saved segments, the issue's "Público", the live preview and the
 * builder's options.
 */

const newsletterBase = (ws: string, newsletterId: string) =>
  `/api/workspaces/${ws}/crm/newsletters/${newsletterId}`

export const crmNewsletterSegmentKeys = {
  list: (ws: string, newsletterId: string) =>
    ['crm-newsletter-segments', ws, newsletterId] as const,
  options: (ws: string, newsletterId: string, query: string, ids: string) =>
    [
      'crm-newsletter-segments',
      ws,
      newsletterId,
      'options',
      query,
      ids,
    ] as const,
  issue: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-issue-segment', ws, newsletterId, issueId] as const,
  preview: (
    ws: string,
    newsletterId: string,
    issueId: string,
    segment: NewsletterSegment | null,
  ) =>
    [
      'crm-newsletter-issue-segment',
      ws,
      newsletterId,
      issueId,
      'preview',
      segment,
    ] as const,
}

export function useCrmNewsletterSegments(
  workspaceId: string,
  newsletterId: string,
) {
  return useQuery({
    queryKey: crmNewsletterSegmentKeys.list(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterSegmentDTO[]>(
        `${newsletterBase(workspaceId, newsletterId)}/segments`,
        undefined,
        'Erro ao buscar os segmentos',
      ),
  })
}

export function useCrmNewsletterSegmentOptions(
  workspaceId: string,
  newsletterId: string,
  companyQuery: string,
  companyIds: string[] = [],
) {
  const ids = [...companyIds].sort().join(',')
  const params = new URLSearchParams({
    ...(companyQuery.trim() ? { companyQuery: companyQuery.trim() } : {}),
    ...(ids ? { companyIds: ids } : {}),
  })
  return useQuery({
    queryKey: crmNewsletterSegmentKeys.options(
      workspaceId,
      newsletterId,
      companyQuery.trim(),
      ids,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterSegmentOptionsDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/segments/options?${params.toString()}`,
        undefined,
        'Erro ao buscar as opções do público',
      ),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })
}

export function useCreateCrmNewsletterSegment(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCrmNewsletterSegmentDTO) =>
      apiFetchJson<CrmNewsletterSegmentDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/segments`,
        'POST',
        input,
        'Erro ao salvar o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterSegmentKeys.list(workspaceId, newsletterId),
      }),
  })
}

export function useUpdateCrmNewsletterSegment(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      segmentId,
      ...input
    }: UpdateCrmNewsletterSegmentDTO & { segmentId: string }) =>
      apiFetchJson<CrmNewsletterSegmentDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/segments/${segmentId}`,
        'PATCH',
        input,
        'Erro ao salvar o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterSegmentKeys.list(workspaceId, newsletterId),
      }),
  })
}

export function useDeleteCrmNewsletterSegment(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: string) =>
      apiSend(
        `${newsletterBase(workspaceId, newsletterId)}/segments/${segmentId}`,
        { method: 'DELETE' },
        'Erro ao excluir o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterSegmentKeys.list(workspaceId, newsletterId),
      }),
  })
}

export function useCrmNewsletterIssueSegment(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  return useQuery({
    queryKey: crmNewsletterSegmentKeys.issue(
      workspaceId,
      newsletterId,
      issueId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterIssueSegmentDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/segment`,
        undefined,
        'Erro ao buscar o público da edição',
      ),
  })
}

/** Saves the issue's audience and refreshes the send dialog's checks. */
export function useSetCrmNewsletterIssueSegment(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetIssueSegmentDTO) =>
      apiFetchJson<CrmNewsletterIssueSegmentDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/segment`,
        'PUT',
        input,
        'Erro ao salvar o público da edição',
      ),
    onSuccess: async (data) => {
      queryClient.setQueryData(
        crmNewsletterSegmentKeys.issue(workspaceId, newsletterId, issueId),
        data,
      )
      await queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.preflight(
          workspaceId,
          newsletterId,
          issueId,
        ),
      })
    },
  })
}

/** Live count + sample of `segment` (null = everyone). */
export function useCrmNewsletterAudiencePreview(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  segment: NewsletterSegment | null,
  enabled = true,
) {
  return useQuery({
    queryKey: crmNewsletterSegmentKeys.preview(
      workspaceId,
      newsletterId,
      issueId,
      segment,
    ),
    queryFn: () =>
      apiFetchJson<CrmNewsletterAudiencePreviewDTO>(
        `${newsletterBase(workspaceId, newsletterId)}/issues/${issueId}/audience-preview`,
        'POST',
        { segment: segment ?? { conditions: [], groups: [] } },
        'Erro ao calcular o público',
      ),
    enabled,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  })
}
