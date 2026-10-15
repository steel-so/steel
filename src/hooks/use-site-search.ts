'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  SearchAiOptimizeDTO,
  SearchApplyDTO,
  UpdateSiteSearchSettingsDTO,
} from '@/src/schemas/site-search.schema'
import type { CrmProductDTO } from '@/types/crm-product'
import type {
  SiteSearchAiOptimizeDTO,
  SiteSearchAiSummaryDTO,
  SiteSearchReportDTO,
  SiteSearchSettingsViewDTO,
} from '@/types/site-search'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Client of the "Buscadores" of a site: settings (business profile,
 * crawlers, llms.txt, IndexNow, verification), the site report, the AI
 * actions and applying reviewed suggestions. Mutations throw `ApiError`
 * with the pt-BR message.
 */
export function siteSearchApi(workspaceId: string) {
  const base = (siteId: string) =>
    `/api/workspaces/${workspaceId}/crm/sites/${siteId}/search`
  return {
    settings: (siteId: string) =>
      apiFetch<SiteSearchSettingsViewDTO>(base(siteId)),
    updateSettings: (siteId: string, dto: UpdateSiteSearchSettingsDTO) =>
      apiFetchJson<SiteSearchSettingsViewDTO>(
        base(siteId),
        'PUT',
        dto,
        'Não foi possível salvar',
      ),
    report: (siteId: string) =>
      apiFetch<SiteSearchReportDTO>(`${base(siteId)}/report`),
    aiSummary: (siteId: string, pageId: string) =>
      apiFetchJson<SiteSearchAiSummaryDTO>(
        `${base(siteId)}/ai/summary`,
        'POST',
        { pageId },
        'A IA não conseguiu resumir a página',
      ),
    aiOptimize: (siteId: string, dto: SearchAiOptimizeDTO) =>
      apiFetchJson<SiteSearchAiOptimizeDTO>(
        `${base(siteId)}/ai/optimize`,
        'POST',
        dto,
        'A IA não conseguiu sugerir melhorias',
      ),
    apply: (siteId: string, dto: SearchApplyDTO) =>
      apiFetchJson<{ updated: string[] }>(
        `${base(siteId)}/apply`,
        'POST',
        dto,
        'Não foi possível aplicar as sugestões',
      ),
    /** Active CRM products (Product structured data). */
    products: () =>
      apiFetch<CrmProductDTO[]>(
        `/api/workspaces/${workspaceId}/crm/products?active=true`,
      ),
  }
}

export type SiteSearchApi = ReturnType<typeof siteSearchApi>

export const siteSearchKeys = {
  settings: (workspaceId: string, siteId: string) =>
    ['site-search', workspaceId, siteId, 'settings'] as const,
  report: (workspaceId: string, siteId: string) =>
    ['site-search', workspaceId, siteId, 'report'] as const,
  products: (workspaceId: string) =>
    ['site-search', workspaceId, 'products'] as const,
}

export function useSiteSearchSettings(workspaceId: string, siteId: string) {
  return useQuery<SiteSearchSettingsViewDTO>({
    queryKey: siteSearchKeys.settings(workspaceId, siteId),
    queryFn: () => siteSearchApi(workspaceId).settings(siteId),
  })
}

export function useSiteSearchReport(
  workspaceId: string,
  siteId: string,
  enabled = true,
) {
  return useQuery<SiteSearchReportDTO>({
    queryKey: siteSearchKeys.report(workspaceId, siteId),
    queryFn: () => siteSearchApi(workspaceId).report(siteId),
    enabled,
  })
}

export function useSiteSearchProducts(workspaceId: string, enabled: boolean) {
  return useQuery<CrmProductDTO[]>({
    queryKey: siteSearchKeys.products(workspaceId),
    queryFn: () => siteSearchApi(workspaceId).products(),
    enabled,
    staleTime: 60_000,
  })
}
