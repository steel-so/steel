'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CrmNewsletterUsageDTO } from '@/src/schemas/crm-newsletter.schema'
import type {
  CreateCrmNewsletterIssueDTO,
  CrmNewsletterIssueDTO,
  CrmNewsletterIssuePreflightDTO,
  CrmNewsletterIssueRecipientDTO,
  CrmNewsletterIssueReportDTO,
  CrmNewsletterIssueStatusValue,
  CrmNewsletterIssueTrendDTO,
  CrmNewsletterRecipientFilter,
  UpdateCrmNewsletterIssueDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Newsletter issues (ADR 0054, slice nl-issues): list, editor, send
 * dialog, report and the month's usage.
 */

export type Paged<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

const issuesBase = (ws: string, newsletterId: string) =>
  `/api/workspaces/${ws}/crm/newsletters/${newsletterId}/issues`

export const crmNewsletterIssueKeys = {
  all: (ws: string, newsletterId: string) =>
    ['crm-newsletter-issues', ws, newsletterId] as const,
  list: (ws: string, newsletterId: string, page: number) =>
    ['crm-newsletter-issues', ws, newsletterId, 'list', page] as const,
  trend: (ws: string, newsletterId: string) =>
    ['crm-newsletter-issues', ws, newsletterId, 'trend'] as const,
  detail: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-issues', ws, newsletterId, 'detail', issueId] as const,
  preflight: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-issues', ws, newsletterId, 'preflight', issueId] as const,
  report: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-issues', ws, newsletterId, 'report', issueId] as const,
  recipients: (
    ws: string,
    newsletterId: string,
    issueId: string,
    query: RecipientsQuery,
  ) =>
    [
      'crm-newsletter-issues',
      ws,
      newsletterId,
      'recipients',
      issueId,
      query,
    ] as const,
  usage: (ws: string) => ['crm-newsletter-usage', ws] as const,
}

/** Statuses whose numbers still move (polled). */
export const LIVE_ISSUE_STATUSES: CrmNewsletterIssueStatusValue[] = [
  'SCHEDULED',
  'SENDING',
]

export function useCrmNewsletterIssues(
  workspaceId: string,
  newsletterId: string,
  page = 1,
) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.list(workspaceId, newsletterId, page),
    queryFn: () =>
      apiFetch<Paged<CrmNewsletterIssueDTO>>(
        `${issuesBase(workspaceId, newsletterId)}?page=${page}&pageSize=25`,
        undefined,
        'Erro ao buscar as edições',
      ),
    refetchInterval: (query) =>
      query.state.data?.items.some((issue) =>
        LIVE_ISSUE_STATUSES.includes(issue.status),
      )
        ? 15_000
        : false,
  })
}

export function useCrmNewsletterIssueTrend(
  workspaceId: string,
  newsletterId: string,
) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.trend(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterIssueTrendDTO>(
        `${issuesBase(workspaceId, newsletterId)}/trend`,
        undefined,
        'Erro ao buscar a evolução das edições',
      ),
  })
}

export function useCrmNewsletterIssue(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  options: { poll?: boolean } = {},
) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.detail(workspaceId, newsletterId, issueId),
    queryFn: () =>
      apiFetch<CrmNewsletterIssueDTO>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}`,
        undefined,
        'Erro ao buscar a edição',
      ),
    refetchInterval: (query) =>
      options.poll &&
      query.state.data &&
      LIVE_ISSUE_STATUSES.includes(query.state.data.status)
        ? 10_000
        : false,
  })
}

export function useCreateCrmNewsletterIssue(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCrmNewsletterIssueDTO) =>
      apiFetchJson<CrmNewsletterIssueDTO>(
        issuesBase(workspaceId, newsletterId),
        'POST',
        input,
        'Erro ao criar a edição',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.all(workspaceId, newsletterId),
      }),
  })
}

/** Plain call for the editor autosave (no re-render on start/end). */
export function saveCrmNewsletterIssue(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  input: UpdateCrmNewsletterIssueDTO,
): Promise<CrmNewsletterIssueDTO> {
  return apiFetchJson<CrmNewsletterIssueDTO>(
    `${issuesBase(workspaceId, newsletterId)}/${issueId}`,
    'PATCH',
    input,
    'Erro ao salvar a edição',
  )
}

export function useDeleteCrmNewsletterIssue(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) =>
      apiSend(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}`,
        { method: 'DELETE' },
        'Erro ao excluir a edição',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.all(workspaceId, newsletterId),
      }),
  })
}

export function useTestSendCrmNewsletterIssue(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  return useMutation({
    mutationFn: (emails: string[]) =>
      apiFetchJson<{ to: string[] }>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}/test`,
        'POST',
        { emails },
        'Erro ao enviar o teste',
      ),
  })
}

export function useCrmNewsletterIssuePreflight(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.preflight(
      workspaceId,
      newsletterId,
      issueId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterIssuePreflightDTO>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}/preflight`,
        undefined,
        'Erro ao conferir a edição',
      ),
    enabled,
    staleTime: 0,
  })
}

type IssueAction = 'send' | 'cancel' | 'stop'

/** Send now / schedule / cancel schedule / stop sending. */
export function useCrmNewsletterIssueAction(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { action: IssueAction; scheduledAt?: string }) =>
      apiFetchJson<CrmNewsletterIssueDTO>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}/${input.action}`,
        'POST',
        input.scheduledAt ? { scheduledAt: input.scheduledAt } : {},
        'Não foi possível concluir a ação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.all(workspaceId, newsletterId),
      }),
  })
}

export function useCrmNewsletterIssueReport(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  live = false,
) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.report(workspaceId, newsletterId, issueId),
    queryFn: () =>
      apiFetch<CrmNewsletterIssueReportDTO>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}/report`,
        undefined,
        'Erro ao buscar o relatório',
      ),
    refetchInterval: live ? 15_000 : false,
  })
}

export type RecipientsQuery = {
  page: number
  filter: CrmNewsletterRecipientFilter
  search: string
}

export function useCrmNewsletterIssueRecipients(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  query: RecipientsQuery,
) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: '25',
    filter: query.filter,
    ...(query.search.trim() ? { search: query.search.trim() } : {}),
  })
  return useQuery({
    queryKey: crmNewsletterIssueKeys.recipients(
      workspaceId,
      newsletterId,
      issueId,
      query,
    ),
    queryFn: () =>
      apiFetch<Paged<CrmNewsletterIssueRecipientDTO>>(
        `${issuesBase(workspaceId, newsletterId)}/${issueId}/recipients?${params.toString()}`,
        undefined,
        'Erro ao buscar os destinatários',
      ),
    placeholderData: (previous) => previous,
  })
}

/** Newsletter e-mails sent this month and the workspace limit. */
export function useCrmNewsletterUsage(workspaceId: string) {
  return useQuery({
    queryKey: crmNewsletterIssueKeys.usage(workspaceId),
    queryFn: () =>
      apiFetch<CrmNewsletterUsageDTO>(
        `/api/workspaces/${workspaceId}/crm/newsletter-usage`,
        undefined,
        'Erro ao buscar o uso do mês',
      ),
  })
}

// ─── Platform admin ─────────────────────────────────────────────────────────

const adminKey = (workspaceId: string) =>
  ['admin-newsletter-settings', workspaceId] as const

export function useAdminNewsletterSettings(workspaceId: string) {
  return useQuery({
    queryKey: adminKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmNewsletterUsageDTO>(
        `/api/admin/workspaces/${workspaceId}/newsletter-settings`,
        undefined,
        'Erro ao buscar o limite da newsletter',
      ),
  })
}

export function useUpdateAdminNewsletterSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (monthlyEmailLimitOverride: number | null) =>
      apiFetchJson<CrmNewsletterUsageDTO>(
        `/api/admin/workspaces/${workspaceId}/newsletter-settings`,
        'PUT',
        { monthlyEmailLimitOverride },
        'Erro ao salvar o limite da newsletter',
      ),
    onSuccess: (data) => queryClient.setQueryData(adminKey(workspaceId), data),
  })
}
