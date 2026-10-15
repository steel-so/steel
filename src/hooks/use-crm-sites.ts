'use client'

import { useQuery } from '@tanstack/react-query'
import type { CreateSiteFromTemplateDTO } from '@/src/schemas/site-studio.schema'
import type { CrmFormDTO } from '@/types/crm-form'
import type {
  SiteDTO,
  SiteGlobalDTO,
  SitePageSummaryDTO,
  SiteSummaryDTO,
  SiteVersionDTO,
} from '@/types/site'
import type { SiteChangesDTO, SiteMediaItemDTO } from '@/types/site-studio'
import { ApiError, apiFetch, apiFetchJson, apiSend } from './_fetch'
import { sitesApi } from './use-sites'

/**
 * Client of the "Sites" screens of the CRM (list, editor, preview): the
 * site builder API (`sitesApi`) plus the editor routes — templates, copy,
 * publish summary and the media library — and the react-query hooks the
 * screens read from. Mutations throw `ApiError` with the pt-BR message.
 */

export type SitePublishResult =
  | { ok: true; site: SiteDTO; version: SiteVersionDTO }
  | { ok: false; message: string; problems: SitePublishProblem[] }

/** A page or global that fails validation (`SITE_DOCUMENT_INVALID`). */
export interface SitePublishProblem {
  id: string
  name: string
  problems: string[]
}

function isProblemList(value: unknown): value is SitePublishProblem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SitePublishProblem).name === 'string' &&
        Array.isArray((item as SitePublishProblem).problems),
    )
  )
}

export function crmSitesApi(workspaceId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/sites`
  return {
    ...sitesApi(workspaceId),
    createFromTemplate: (dto: CreateSiteFromTemplateDTO) =>
      apiFetchJson<SiteDTO>(`${base}/from-template`, 'POST', dto),
    duplicate: (siteId: string, name?: string) =>
      apiFetchJson<SiteDTO>(
        `${base}/${siteId}/duplicate`,
        'POST',
        name ? { name } : {},
      ),
    changes: (siteId: string) =>
      apiFetch<SiteChangesDTO>(`${base}/${siteId}/changes`),
    /** Publish keeping the per-page problems of an invalid draft. */
    publishDetailed: async (siteId: string): Promise<SitePublishResult> => {
      const res = await fetch(`${base}/${siteId}/publish`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (res.ok) return { ok: true, ...body.data }
      const details = body?.error?.details
      if (body?.error?.code === 'SITE_DOCUMENT_INVALID') {
        return {
          ok: false,
          message: body?.message ?? 'Corrija as páginas com problemas',
          problems: isProblemList(details) ? details : [],
        }
      }
      throw new ApiError(
        body?.message ?? 'Não foi possível publicar o site',
        body?.error?.code ?? null,
        res.status,
      )
    },
    media: () => apiFetch<SiteMediaItemDTO[]>(`${base}/media`),
    uploadMedia: (file: File) =>
      apiFetch<SiteMediaItemDTO>(
        `${base}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        },
        'Não foi possível enviar a imagem',
      ),
    removeMedia: (id: string) =>
      apiSend(`${base}/media?${new URLSearchParams({ id })}`, {
        method: 'DELETE',
      }),
    /** CRM forms of the workspace (the form picker of `site.form`). */
    forms: () =>
      apiFetch<CrmFormDTO[]>(`/api/workspaces/${workspaceId}/crm/forms`),
    /** Old landing pages (only counted, for the migration banner). */
    landingPages: () =>
      apiFetch<unknown[]>(`/api/workspaces/${workspaceId}/crm/landing-pages`),
  }
}

export type CrmSitesApi = ReturnType<typeof crmSitesApi>

export const crmSitesKeys = {
  all: (workspaceId: string) => ['crm-sites', workspaceId] as const,
  list: (workspaceId: string) => ['crm-sites', workspaceId, 'list'] as const,
  site: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId] as const,
  pages: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'pages'] as const,
  globals: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'globals'] as const,
  page: (workspaceId: string, siteId: string, pageId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'page', pageId] as const,
  versions: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'versions'] as const,
  changes: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'changes'] as const,
  media: (workspaceId: string) => ['crm-sites', workspaceId, 'media'] as const,
  forms: (workspaceId: string) => ['crm-sites', workspaceId, 'forms'] as const,
  landingPages: (workspaceId: string) =>
    ['crm-sites', workspaceId, 'landing-pages'] as const,
}

/** Sites of the workspace (list page). */
export function useCrmSites(workspaceId: string) {
  return useQuery<SiteSummaryDTO[]>({
    queryKey: crmSitesKeys.list(workspaceId),
    queryFn: () => crmSitesApi(workspaceId).list(),
  })
}

/** Count of the old landing pages (migration banner). */
export function useLegacyLandingPageCount(workspaceId: string) {
  return useQuery<number>({
    queryKey: crmSitesKeys.landingPages(workspaceId),
    queryFn: async () => (await crmSitesApi(workspaceId).landingPages()).length,
    staleTime: 5 * 60_000,
  })
}

/** Site, page tree and globals of the editor. */
export function useCrmSite(workspaceId: string, siteId: string) {
  const api = crmSitesApi(workspaceId)
  const site = useQuery<SiteDTO>({
    queryKey: crmSitesKeys.site(workspaceId, siteId),
    queryFn: () => api.get(siteId),
  })
  const pages = useQuery<SitePageSummaryDTO[]>({
    queryKey: crmSitesKeys.pages(workspaceId, siteId),
    queryFn: () => api.pages(siteId),
  })
  const globals = useQuery<SiteGlobalDTO[]>({
    queryKey: crmSitesKeys.globals(workspaceId, siteId),
    queryFn: () => api.globals(siteId),
  })
  return { site, pages, globals }
}

export function useSiteVersions(
  workspaceId: string,
  siteId: string,
  enabled: boolean,
) {
  return useQuery<SiteVersionDTO[]>({
    queryKey: crmSitesKeys.versions(workspaceId, siteId),
    queryFn: () => crmSitesApi(workspaceId).versions(siteId),
    enabled,
  })
}

export function useSiteChanges(
  workspaceId: string,
  siteId: string,
  enabled: boolean,
) {
  return useQuery<SiteChangesDTO>({
    queryKey: crmSitesKeys.changes(workspaceId, siteId),
    queryFn: () => crmSitesApi(workspaceId).changes(siteId),
    enabled,
    staleTime: 0,
  })
}

export function useSiteMedia(workspaceId: string) {
  return useQuery<SiteMediaItemDTO[]>({
    queryKey: crmSitesKeys.media(workspaceId),
    queryFn: () => crmSitesApi(workspaceId).media(),
  })
}

export function useSiteForms(workspaceId: string) {
  return useQuery<CrmFormDTO[]>({
    queryKey: crmSitesKeys.forms(workspaceId),
    queryFn: () => crmSitesApi(workspaceId).forms(),
    staleTime: 60_000,
  })
}
