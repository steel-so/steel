'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CreateSiteDTO, UpdateSiteDTO } from '@/src/schemas/site.schema'
import type {
  CreateSiteGlobalDTO,
  UpdateSiteGlobalDTO,
} from '@/src/schemas/site-global.schema'
import type {
  CreateSitePageDTO,
  UpdateSitePageDTO,
} from '@/src/schemas/site-page.schema'
import type {
  SiteDTO,
  SiteGlobalDTO,
  SitePageDTO,
  SitePageSummaryDTO,
  SiteSummaryDTO,
  SiteVersionDTO,
} from '@/types/site'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client API of the site builder (`/api/workspaces/[id]/crm/sites/**`).
 * Mutations throw `ApiError` (message in pt-BR, `code` from ERROR_CODES:
 * `SITE_SLUG_TAKEN`, `SITE_DOCUMENT_INVALID` with `details`…).
 */
export function sitesApi(workspaceId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/sites`
  const site = (siteId: string) => `${base}/${siteId}`
  return {
    list: () => apiFetch<SiteSummaryDTO[]>(base),
    get: (siteId: string) => apiFetch<SiteDTO>(site(siteId)),
    create: (dto: CreateSiteDTO) => apiFetchJson<SiteDTO>(base, 'POST', dto),
    update: (siteId: string, dto: UpdateSiteDTO) =>
      apiFetchJson<SiteDTO>(site(siteId), 'PATCH', dto),
    remove: (siteId: string) => apiSend(site(siteId), { method: 'DELETE' }),
    checkSlug: (slug: string, siteId?: string) =>
      apiFetch<{ slug: string; available: boolean }>(
        `${base}/slug-availability?${new URLSearchParams({
          slug,
          ...(siteId ? { siteId } : {}),
        })}`,
      ),
    publish: (siteId: string) =>
      apiFetchJson<{ site: SiteDTO; version: SiteVersionDTO }>(
        `${site(siteId)}/publish`,
        'POST',
      ),
    unpublish: (siteId: string) =>
      apiFetchJson<SiteDTO>(`${site(siteId)}/publish`, 'DELETE'),
    versions: (siteId: string) =>
      apiFetch<SiteVersionDTO[]>(`${site(siteId)}/versions`),
    restore: (siteId: string, versionId: string) =>
      apiFetchJson<SiteDTO>(
        `${site(siteId)}/versions/${versionId}/restore`,
        'POST',
      ),
    pages: (siteId: string) =>
      apiFetch<SitePageSummaryDTO[]>(`${site(siteId)}/pages`),
    page: (siteId: string, pageId: string) =>
      apiFetch<SitePageDTO>(`${site(siteId)}/pages/${pageId}`),
    createPage: (siteId: string, dto: CreateSitePageDTO) =>
      apiFetchJson<SitePageDTO>(`${site(siteId)}/pages`, 'POST', dto),
    updatePage: (siteId: string, pageId: string, dto: UpdateSitePageDTO) =>
      apiFetchJson<SitePageDTO>(
        `${site(siteId)}/pages/${pageId}`,
        'PATCH',
        dto,
      ),
    removePage: (siteId: string, pageId: string) =>
      apiSend(`${site(siteId)}/pages/${pageId}`, { method: 'DELETE' }),
    duplicatePage: (siteId: string, pageId: string, title?: string) =>
      apiFetchJson<SitePageDTO>(
        `${site(siteId)}/pages/${pageId}/duplicate`,
        'POST',
        title ? { title } : {},
      ),
    reorderPages: (siteId: string, orderedIds: string[]) =>
      apiFetchJson<null>(`${site(siteId)}/pages/reorder`, 'PATCH', {
        orderedIds,
      }),
    globals: (siteId: string) =>
      apiFetch<SiteGlobalDTO[]>(`${site(siteId)}/globals`),
    createGlobal: (siteId: string, dto: CreateSiteGlobalDTO) =>
      apiFetchJson<SiteGlobalDTO>(`${site(siteId)}/globals`, 'POST', dto),
    updateGlobal: (
      siteId: string,
      globalId: string,
      dto: UpdateSiteGlobalDTO,
    ) =>
      apiFetchJson<SiteGlobalDTO>(
        `${site(siteId)}/globals/${globalId}`,
        'PATCH',
        dto,
      ),
    removeGlobal: (siteId: string, globalId: string) =>
      apiSend(`${site(siteId)}/globals/${globalId}`, { method: 'DELETE' }),
    migrateLandingPages: () =>
      apiFetchJson<{ created: number; skipped: number; failed: number }>(
        `${base}/migrate-landing-pages`,
        'POST',
      ),
  }
}

function useLoader<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    try {
      setData(await load())
      setError(null)
    } catch (caught) {
      setError(caught as Error)
    } finally {
      setIsLoading(false)
    }
  }, [load])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { data, error, isLoading, refetch }
}

/** Sites of the workspace (list page). */
export function useSites(workspaceId: string) {
  const load = useCallback(() => sitesApi(workspaceId).list(), [workspaceId])
  const { data, ...rest } = useLoader(load)
  return { sites: data ?? [], ...rest }
}

/** One site with its page tree (editor shell). */
export function useSite(workspaceId: string, siteId: string) {
  const load = useCallback(async () => {
    const api = sitesApi(workspaceId)
    const [site, pages] = await Promise.all([
      api.get(siteId),
      api.pages(siteId),
    ])
    return { site, pages }
  }, [workspaceId, siteId])
  const { data, ...rest } = useLoader(load)
  return { site: data?.site ?? null, pages: data?.pages ?? [], ...rest }
}
