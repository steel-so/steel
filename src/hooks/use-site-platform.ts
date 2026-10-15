'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  CreateSiteRedirectDTO,
  UpdateSiteRedirectDTO,
} from '@/src/schemas/site-redirect.schema'
import type {
  SiteAnalyticsDTO,
  SiteAnalyticsSummaryDTO,
  SiteRedirectDTO,
} from '@/types/site-platform'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client of the sites platform routes (wave S2): redirects manager and
 * metrics. Mutations throw `ApiError` with the pt-BR message.
 */
export function sitePlatformApi(workspaceId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/sites`
  return {
    redirects: (siteId: string) =>
      apiFetch<SiteRedirectDTO[]>(`${base}/${siteId}/redirects`),
    createRedirect: (siteId: string, dto: CreateSiteRedirectDTO) =>
      apiFetchJson<SiteRedirectDTO>(
        `${base}/${siteId}/redirects`,
        'POST',
        dto,
        'Não foi possível criar o redirecionamento',
      ),
    updateRedirect: (
      siteId: string,
      redirectId: string,
      dto: UpdateSiteRedirectDTO,
    ) =>
      apiFetchJson<SiteRedirectDTO>(
        `${base}/${siteId}/redirects/${redirectId}`,
        'PATCH',
        dto,
        'Não foi possível salvar o redirecionamento',
      ),
    removeRedirect: (siteId: string, redirectId: string) =>
      apiSend(
        `${base}/${siteId}/redirects/${redirectId}`,
        { method: 'DELETE' },
        'Não foi possível excluir o redirecionamento',
      ),
    analytics: (siteId: string, range: { from?: string; to?: string }) => {
      const query = new URLSearchParams()
      if (range.from) query.set('from', range.from)
      if (range.to) query.set('to', range.to)
      const suffix = query.size ? `?${query}` : ''
      return apiFetch<SiteAnalyticsDTO>(`${base}/${siteId}/analytics${suffix}`)
    },
    summary: (days: number) =>
      apiFetch<SiteAnalyticsSummaryDTO>(`${base}/analytics?days=${days}`),
  }
}

export type SitePlatformApi = ReturnType<typeof sitePlatformApi>

export const sitePlatformKeys = {
  redirects: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'redirects'] as const,
  analytics: (
    workspaceId: string,
    siteId: string,
    range: { from?: string; to?: string },
  ) =>
    [
      'crm-sites',
      workspaceId,
      'site',
      siteId,
      'analytics',
      range.from ?? '',
      range.to ?? '',
    ] as const,
  summary: (workspaceId: string, days: number) =>
    ['crm-sites', workspaceId, 'analytics-summary', days] as const,
}

export function useSiteRedirects(
  workspaceId: string,
  siteId: string,
  enabled = true,
) {
  return useQuery<SiteRedirectDTO[]>({
    queryKey: sitePlatformKeys.redirects(workspaceId, siteId),
    queryFn: () => sitePlatformApi(workspaceId).redirects(siteId),
    enabled,
  })
}

export function useSiteAnalytics(
  workspaceId: string,
  siteId: string,
  range: { from?: string; to?: string },
) {
  return useQuery<SiteAnalyticsDTO>({
    queryKey: sitePlatformKeys.analytics(workspaceId, siteId, range),
    queryFn: () => sitePlatformApi(workspaceId).analytics(siteId, range),
    staleTime: 60_000,
  })
}

/** Daily views of every site (the list cards' sparklines). */
export function useSitesAnalyticsSummary(workspaceId: string, days = 14) {
  return useQuery<SiteAnalyticsSummaryDTO>({
    queryKey: sitePlatformKeys.summary(workspaceId, days),
    queryFn: () => sitePlatformApi(workspaceId).summary(days),
    staleTime: 5 * 60_000,
  })
}
