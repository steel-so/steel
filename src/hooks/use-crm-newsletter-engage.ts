'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmNewsletterIssuePollsDTO,
  CrmNewsletterIssueWhatsAppDTO,
  CrmNewsletterWhatsAppReportDTO,
  UpdateCrmNewsletterIssueWhatsAppDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import type { CRM_NEWSLETTER_DELIVERY_STATUSES } from '@/src/schemas/crm-newsletter-issue.schema'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Engagement of a newsletter issue (slice nl2-engage): poll results and
 * the WhatsApp version (settings in the editor, delivery in the report).
 */

const issueBase = (ws: string, newsletterId: string, issueId: string) =>
  `/api/workspaces/${ws}/crm/newsletters/${newsletterId}/issues/${issueId}`

export const crmNewsletterEngageKeys = {
  polls: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-engage', ws, newsletterId, issueId, 'polls'] as const,
  whatsapp: (ws: string, newsletterId: string, issueId: string) =>
    ['crm-newsletter-engage', ws, newsletterId, issueId, 'whatsapp'] as const,
  whatsappReport: (
    ws: string,
    newsletterId: string,
    issueId: string,
    query: WhatsAppReportQuery,
  ) =>
    [
      'crm-newsletter-engage',
      ws,
      newsletterId,
      issueId,
      'whatsapp-report',
      query,
    ] as const,
}

/** CSV of every vote (download link). */
export function crmNewsletterPollsExportUrl(
  ws: string,
  newsletterId: string,
  issueId: string,
): string {
  return `${issueBase(ws, newsletterId, issueId)}/polls/export`
}

export function useCrmNewsletterIssuePolls(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  live = false,
) {
  return useQuery({
    queryKey: crmNewsletterEngageKeys.polls(workspaceId, newsletterId, issueId),
    queryFn: () =>
      apiFetch<CrmNewsletterIssuePollsDTO>(
        `${issueBase(workspaceId, newsletterId, issueId)}/polls`,
        undefined,
        'Erro ao buscar o resultado das enquetes',
      ),
    refetchInterval: live ? 30_000 : false,
  })
}

export function useCrmNewsletterIssueWhatsApp(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: crmNewsletterEngageKeys.whatsapp(
      workspaceId,
      newsletterId,
      issueId,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterIssueWhatsAppDTO>(
        `${issueBase(workspaceId, newsletterId, issueId)}/whatsapp`,
        undefined,
        'Erro ao buscar o envio no WhatsApp',
      ),
    enabled,
  })
}

export function useSaveCrmNewsletterIssueWhatsApp(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCrmNewsletterIssueWhatsAppDTO) =>
      apiFetchJson<CrmNewsletterIssueWhatsAppDTO>(
        `${issueBase(workspaceId, newsletterId, issueId)}/whatsapp`,
        'PATCH',
        input,
        'Erro ao salvar o envio no WhatsApp',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        crmNewsletterEngageKeys.whatsapp(workspaceId, newsletterId, issueId),
        data,
      )
    },
  })
}

export type CrmNewsletterDeliveryStatusValue =
  (typeof CRM_NEWSLETTER_DELIVERY_STATUSES)[number]

export type WhatsAppReportQuery = {
  page: number
  status: CrmNewsletterDeliveryStatusValue | null
}

export function useCrmNewsletterWhatsAppReport(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
  query: WhatsAppReportQuery,
  live = false,
) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: '25',
  })
  if (query.status) params.set('status', query.status)
  return useQuery({
    queryKey: crmNewsletterEngageKeys.whatsappReport(
      workspaceId,
      newsletterId,
      issueId,
      query,
    ),
    queryFn: () =>
      apiFetch<CrmNewsletterWhatsAppReportDTO>(
        `${issueBase(workspaceId, newsletterId, issueId)}/whatsapp/recipients?${params}`,
        undefined,
        'Erro ao buscar o envio no WhatsApp',
      ),
    refetchInterval: (state) =>
      live || (state.state.data?.stats.pending ?? 0) > 0 ? 15_000 : false,
  })
}
