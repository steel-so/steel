'use client'

import { useQuery } from '@tanstack/react-query'
import type { CreateSeoKeywordDTO } from '@/src/schemas/site-seo.schema'
import type {
  SiteSeoDetailDTO,
  SiteSeoKeywordDTO,
  SiteSeoOverviewDTO,
  SiteSeoReindexDTO,
} from '@/types/site-seo'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client of CRM > SEO: the overview of every site, the detail of one site
 * (checklist, keywords, history), tracked keywords and the manual IndexNow
 * ping. The per-site AI actions (`aiOptimize`, `apply`) live in
 * `siteSearchApi`. Mutations throw `ApiError` with the pt-BR message.
 */
export function siteSeoApi(workspaceId: string) {
  const site = (siteId: string) =>
    `/api/workspaces/${workspaceId}/crm/sites/${siteId}/search`
  return {
    overview: () =>
      apiFetch<SiteSeoOverviewDTO>(`/api/workspaces/${workspaceId}/crm/seo`),
    detail: (siteId: string) =>
      apiFetch<SiteSeoDetailDTO>(`${site(siteId)}/seo`),
    addKeyword: (siteId: string, dto: CreateSeoKeywordDTO) =>
      apiFetchJson<SiteSeoKeywordDTO>(
        `${site(siteId)}/keywords`,
        'POST',
        dto,
        'Não foi possível acompanhar a palavra-chave',
      ),
    removeKeyword: (siteId: string, keywordId: string) =>
      apiSend(
        `${site(siteId)}/keywords/${keywordId}`,
        { method: 'DELETE' },
        'Não foi possível remover a palavra-chave',
      ),
    reindex: (siteId: string) =>
      apiFetchJson<SiteSeoReindexDTO>(
        `${site(siteId)}/reindex`,
        'POST',
        undefined,
        'Não foi possível pedir a reindexação',
      ),
  }
}

export type SiteSeoApi = ReturnType<typeof siteSeoApi>

export const siteSeoKeys = {
  all: (workspaceId: string) => ['site-seo', workspaceId] as const,
  overview: (workspaceId: string) =>
    ['site-seo', workspaceId, 'overview'] as const,
  detail: (workspaceId: string, siteId: string) =>
    ['site-seo', workspaceId, 'detail', siteId] as const,
}

export function useSiteSeoOverview(workspaceId: string) {
  return useQuery<SiteSeoOverviewDTO>({
    queryKey: siteSeoKeys.overview(workspaceId),
    queryFn: () => siteSeoApi(workspaceId).overview(),
  })
}

export function useSiteSeoDetail(workspaceId: string, siteId: string | null) {
  return useQuery<SiteSeoDetailDTO>({
    queryKey: siteSeoKeys.detail(workspaceId, siteId ?? ''),
    queryFn: () => siteSeoApi(workspaceId).detail(siteId as string),
    enabled: Boolean(siteId),
  })
}
