'use client'

import { useQuery } from '@tanstack/react-query'
import type { UpdateBioLinkDTO } from '@/src/schemas/bio-link.schema'
import type {
  BioLinkAnalyticsDTO,
  BioLinkDTO,
  BioLinkOptionsDTO,
  BioLinkSummaryDTO,
} from '@/types/bio-link'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

export function bioLinksApi(workspaceId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/bio-links`
  return {
    list: () => apiFetch<BioLinkSummaryDTO[]>(base),
    get: (id: string) => apiFetch<BioLinkDTO>(`${base}/${id}`),
    create: (input: { name: string; slug?: string }) =>
      apiFetchJson<BioLinkDTO>(
        base,
        'POST',
        input,
        'Não foi possível criar a página',
      ),
    update: (id: string, patch: UpdateBioLinkDTO) =>
      apiFetchJson<BioLinkDTO>(
        `${base}/${id}`,
        'PATCH',
        patch,
        'Não foi possível salvar a página',
      ),
    remove: (id: string) =>
      apiSend(
        `${base}/${id}`,
        { method: 'DELETE' },
        'Não foi possível excluir a página',
      ),
    options: () => apiFetch<BioLinkOptionsDTO>(`${base}/options`),
    analytics: (id: string, days: number) =>
      apiFetch<BioLinkAnalyticsDTO>(`${base}/${id}/analytics?days=${days}`),
    slugAvailability: (slug: string, bioLinkId?: string) =>
      apiFetch<{ slug: string; available: boolean }>(
        `${base}/slug-availability?${new URLSearchParams({
          slug,
          ...(bioLinkId ? { bioLinkId } : {}),
        })}`,
      ),
  }
}

export const bioLinkKeys = {
  all: (workspaceId: string) => ['bio-links', workspaceId] as const,
  list: (workspaceId: string) => ['bio-links', workspaceId, 'list'] as const,
  detail: (workspaceId: string, id: string) =>
    ['bio-links', workspaceId, 'detail', id] as const,
  options: (workspaceId: string) =>
    ['bio-links', workspaceId, 'options'] as const,
  analytics: (workspaceId: string, id: string, days: number) =>
    ['bio-links', workspaceId, 'analytics', id, days] as const,
}

/** Bio pages of the workspace (list page). */
export function useBioLinks(workspaceId: string) {
  return useQuery<BioLinkSummaryDTO[]>({
    queryKey: bioLinkKeys.list(workspaceId),
    queryFn: () => bioLinksApi(workspaceId).list(),
  })
}

export function useBioLink(workspaceId: string, id: string) {
  return useQuery<BioLinkDTO>({
    queryKey: bioLinkKeys.detail(workspaceId, id),
    queryFn: () => bioLinksApi(workspaceId).get(id),
    // The editor owns the draft: never refetch over it.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
}

/** WhatsApp lines, published sites and forms for the ready-made buttons. */
export function useBioLinkOptions(workspaceId: string) {
  return useQuery<BioLinkOptionsDTO>({
    queryKey: bioLinkKeys.options(workspaceId),
    queryFn: () => bioLinksApi(workspaceId).options(),
    staleTime: 60_000,
  })
}

export function useBioLinkAnalytics(
  workspaceId: string,
  id: string,
  days: number,
) {
  return useQuery<BioLinkAnalyticsDTO>({
    queryKey: bioLinkKeys.analytics(workspaceId, id, days),
    queryFn: () => bioLinksApi(workspaceId).analytics(id, days),
    staleTime: 30_000,
  })
}
