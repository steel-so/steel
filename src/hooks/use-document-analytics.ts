'use client'

import { useQuery } from '@tanstack/react-query'
import type { DocumentAnalyticsPeriod } from '@/src/schemas/document-analytics.schema'
import type { DocumentAnalyticsDTO } from '@/types/document'
import { apiFetch } from './_fetch'

/**
 * Reading analytics of a document (CRM > Documentos, ADR 0063). The server
 * flushes the reading buffer every minute, so the panel refetches on the
 * same beat while it is open.
 */

export const documentAnalyticsKeys = {
  all: (workspaceId: string) => ['document-analytics', workspaceId] as const,
  detail: (
    workspaceId: string,
    documentId: string,
    period: DocumentAnalyticsPeriod,
  ) =>
    [...documentAnalyticsKeys.all(workspaceId), documentId, period] as const,
}

export function documentAnalyticsUrl(
  workspaceId: string,
  documentId: string,
  period: DocumentAnalyticsPeriod,
): string {
  const base = `/api/workspaces/${workspaceId}/crm/documents/${documentId}/analytics`
  return period === 'all' ? base : `${base}?days=${period}`
}

export function fetchDocumentAnalytics(
  workspaceId: string,
  documentId: string,
  period: DocumentAnalyticsPeriod,
): Promise<DocumentAnalyticsDTO> {
  return apiFetch<DocumentAnalyticsDTO>(
    documentAnalyticsUrl(workspaceId, documentId, period),
    undefined,
    'Não foi possível carregar a leitura do documento',
  )
}

export function useDocumentAnalytics(
  workspaceId: string,
  documentId: string,
  period: DocumentAnalyticsPeriod = 'all',
) {
  return useQuery<DocumentAnalyticsDTO>({
    queryKey: documentAnalyticsKeys.detail(workspaceId, documentId, period),
    queryFn: () => fetchDocumentAnalytics(workspaceId, documentId, period),
    enabled: Boolean(workspaceId && documentId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
