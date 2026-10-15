'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSiteExperimentDTO,
  SiteExperimentAction,
  UpdateSiteExperimentDTO,
} from '@/src/schemas/site-experiment.schema'
import type {
  SiteExperimentDTO,
  SiteExperimentImpactDTO,
  SiteExperimentVariantKey,
} from '@/types/site-experiment'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client of the A/B test routes of a site (wave S4). Mutations throw
 * `ApiError` with the pt-BR message (`SITE_EXPERIMENT_RUNNING` asks the UI
 * to confirm a restart).
 */
export function siteExperimentsApi(workspaceId: string, siteId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/sites/${siteId}/experiments`
  return {
    list: () => apiFetch<SiteExperimentDTO[]>(base),
    impact: () => apiFetch<SiteExperimentImpactDTO>(`${base}/impact`),
    create: (dto: Partial<CreateSiteExperimentDTO>) =>
      apiFetchJson<SiteExperimentDTO>(
        base,
        'POST',
        dto,
        'Não foi possível criar o teste',
      ),
    update: (experimentId: string, dto: UpdateSiteExperimentDTO) =>
      apiFetchJson<SiteExperimentDTO>(
        `${base}/${experimentId}`,
        'PATCH',
        dto,
        'Não foi possível salvar o teste',
      ),
    transition: (experimentId: string, action: SiteExperimentAction) =>
      apiFetchJson<SiteExperimentDTO>(
        `${base}/${experimentId}/status`,
        'POST',
        { action },
        'Não foi possível atualizar o teste',
      ),
    applyWinner: (experimentId: string, variantKey: SiteExperimentVariantKey) =>
      apiFetchJson<SiteExperimentDTO>(
        `${base}/${experimentId}/apply-winner`,
        'POST',
        { variantKey },
        'Não foi possível aplicar a vencedora',
      ),
    remove: (experimentId: string) =>
      apiSend(
        `${base}/${experimentId}`,
        { method: 'DELETE' },
        'Não foi possível excluir o teste',
      ),
  }
}

export type SiteExperimentsApi = ReturnType<typeof siteExperimentsApi>

export const siteExperimentKeys = {
  list: (workspaceId: string, siteId: string) =>
    ['crm-sites', workspaceId, 'site', siteId, 'experiments'] as const,
  impact: (workspaceId: string, siteId: string) =>
    [
      'crm-sites',
      workspaceId,
      'site',
      siteId,
      'experiments',
      'impact',
    ] as const,
}

export function useSiteExperiments(
  workspaceId: string,
  siteId: string,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useQuery<SiteExperimentDTO[]>({
    queryKey: siteExperimentKeys.list(workspaceId, siteId),
    queryFn: () => siteExperimentsApi(workspaceId, siteId).list(),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
    staleTime: 15_000,
  })
}

/** Running tests the next publish restarts (publish dialog). */
export function useSiteExperimentImpact(
  workspaceId: string,
  siteId: string,
  enabled: boolean,
) {
  return useQuery<SiteExperimentImpactDTO>({
    queryKey: siteExperimentKeys.impact(workspaceId, siteId),
    queryFn: () => siteExperimentsApi(workspaceId, siteId).impact(),
    enabled,
    staleTime: 0,
  })
}

/** Mutations that refresh the list (and the site pages, which "Aplicar
 * vencedora", page tests and deletes change). */
export function useSiteExperimentMutations(
  workspaceId: string,
  siteId: string,
) {
  const queryClient = useQueryClient()
  const api = siteExperimentsApi(workspaceId, siteId)
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['crm-sites', workspaceId, 'site', siteId],
    })
  }
  const upsert = (saved: SiteExperimentDTO) =>
    queryClient.setQueryData<SiteExperimentDTO[]>(
      siteExperimentKeys.list(workspaceId, siteId),
      (current) =>
        current?.some((item) => item.id === saved.id)
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...(current ?? [])],
    )

  return {
    create: useMutation({
      mutationFn: (dto: Partial<CreateSiteExperimentDTO>) => api.create(dto),
      onSuccess: async (saved) => {
        upsert(saved)
        // Page tests add hidden copies to the page list. The page being
        // edited is left alone (its canvas owns the document).
        await queryClient.invalidateQueries({
          queryKey: ['crm-sites', workspaceId, 'site', siteId, 'pages'],
        })
      },
    }),
    update: useMutation({
      mutationFn: (input: { id: string; dto: UpdateSiteExperimentDTO }) =>
        api.update(input.id, input.dto),
      onSuccess: upsert,
    }),
    transition: useMutation({
      mutationFn: (input: { id: string; action: SiteExperimentAction }) =>
        api.transition(input.id, input.action),
      onSuccess: upsert,
    }),
    applyWinner: useMutation({
      mutationFn: (input: {
        id: string
        variantKey: SiteExperimentVariantKey
      }) => api.applyWinner(input.id, input.variantKey),
      onSuccess: async (saved) => {
        upsert(saved)
        await refresh()
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.remove(id),
      onSuccess: refresh,
    }),
  }
}
