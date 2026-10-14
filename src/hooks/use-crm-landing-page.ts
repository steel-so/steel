'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CrmLandingPageSectionInputDTO } from '@/src/schemas/crm-landing-page-section.schema'
import type { CrmLandingPageDTO } from '@/types/crm-landing-page'
import { apiFetch } from './_fetch'

export type MutationResult<T> = { ok: boolean; data?: T; message?: string }

function readError(json: unknown): string {
  const data = json as {
    message?: string
    error?: { details?: { fieldErrors?: Record<string, string[]> } }
  }
  const fieldErrors = data?.error?.details?.fieldErrors
  if (fieldErrors) {
    const parts = Object.entries(fieldErrors)
      .filter(([, messages]) => messages?.length)
      .map(([field, messages]) => `${field}: ${messages[0]}`)
    if (parts.length > 0) return parts.join(' · ')
  }
  return data?.message ?? 'Não foi possível salvar.'
}

function collectionUrl(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/crm/landing-pages`
}

function baseUrl(workspaceId: string, pageId: string): string {
  return `${collectionUrl(workspaceId)}/${pageId}`
}

function pagesKey(workspaceId: string) {
  return ['crm-landing-pages', workspaceId] as const
}

function pageKey(workspaceId: string, pageId: string) {
  return ['crm-landing-page', workspaceId, pageId] as const
}

/** Carrega uma landing page (com seções), usada pelo builder. */
export function useCrmLandingPage(workspaceId: string, pageId: string) {
  return useQuery({
    queryKey: pageKey(workspaceId, pageId),
    queryFn: () =>
      apiFetch<CrmLandingPageDTO>(
        baseUrl(workspaceId, pageId),
        undefined,
        'Erro ao buscar landing page',
      ),
    enabled: !!workspaceId && !!pageId,
  })
}

export function useCreateCrmLandingPage(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title: string
      templateKey: string
      sections: CrmLandingPageSectionInputDTO[]
    }) =>
      apiFetch<CrmLandingPageDTO>(
        collectionUrl(workspaceId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar landing page',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pagesKey(workspaceId) })
    },
  })
}

export function useUpdateCrmLandingPage(workspaceId: string, pageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: {
      title?: string
      sections?: CrmLandingPageSectionInputDTO[]
      status?: 'DRAFT' | 'PUBLISHED'
    }) =>
      apiFetch<CrmLandingPageDTO>(
        baseUrl(workspaceId, pageId),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Erro ao salvar landing page',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(pageKey(workspaceId, pageId), data)
      queryClient.invalidateQueries({ queryKey: pagesKey(workspaceId) })
    },
  })
}

export function useSetCrmLandingPagePublished(
  workspaceId: string,
  pageId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (published: boolean) =>
      apiFetch<CrmLandingPageDTO>(
        `${baseUrl(workspaceId, pageId)}/publish`,
        { method: published ? 'POST' : 'DELETE' },
        'Erro ao alterar publicação',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(pageKey(workspaceId, pageId), data)
      queryClient.invalidateQueries({ queryKey: pagesKey(workspaceId) })
    },
  })
}

export async function uploadCrmLandingPageImage(
  workspaceId: string,
  file: File,
): Promise<MutationResult<{ url: string }>> {
  try {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/crm/landing-pages/images`,
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      },
    )
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, message: readError(json) }
    return { ok: true, data: json.data as { url: string } }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

export async function uploadCrmLandingPageVideo(
  workspaceId: string,
  file: File,
): Promise<MutationResult<{ url: string }>> {
  try {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/crm/landing-pages/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      },
    )
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, message: readError(json) }
    return { ok: true, data: json.data as { url: string } }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}
