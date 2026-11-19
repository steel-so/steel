import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCrmBannerDTO,
  CrmBannerAiBriefInput,
  UpdateCrmBannerDTO,
} from '@/src/schemas/crm-banner.schema'
import type {
  CrmBannerAiResultDTO,
  CrmBannerDTO,
  CrmBannerListItemDTO,
} from '@/types/crm-banner'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

type CreateInput = Omit<CreateCrmBannerDTO, 'folder' | 'tags' | 'objective'> &
  Partial<Pick<CreateCrmBannerDTO, 'folder' | 'tags' | 'objective'>>

export const crmBannersKeys = {
  list: (workspaceId: string) => ['crm-banners', workspaceId, 'list'] as const,
  detail: (workspaceId: string, bannerId: string) =>
    ['crm-banners', workspaceId, 'detail', bannerId] as const,
}

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/banners`

export const crmBannersApi = (workspaceId: string) => ({
  list: () =>
    apiFetch<CrmBannerListItemDTO[]>(
      base(workspaceId),
      undefined,
      'Não foi possível carregar os banners',
    ),
  get: (bannerId: string) =>
    apiFetch<CrmBannerDTO>(
      `${base(workspaceId)}/${bannerId}`,
      undefined,
      'Não foi possível carregar o banner',
    ),
  create: (data: CreateInput) =>
    apiFetchJson<CrmBannerDTO>(
      base(workspaceId),
      'POST',
      data,
      'Não foi possível criar o banner',
    ),
  update: (bannerId: string, data: UpdateCrmBannerDTO) =>
    apiFetchJson<CrmBannerDTO>(
      `${base(workspaceId)}/${bannerId}`,
      'PATCH',
      data,
      'Não foi possível salvar o banner',
    ),
  duplicate: (bannerId: string) =>
    apiFetchJson<CrmBannerDTO>(
      `${base(workspaceId)}/${bannerId}/duplicate`,
      'POST',
      {},
      'Não foi possível duplicar o banner',
    ),
  remove: (bannerId: string) =>
    apiSend(
      `${base(workspaceId)}/${bannerId}`,
      { method: 'DELETE' },
      'Não foi possível excluir o banner',
    ),
  generateCopy: (brief: CrmBannerAiBriefInput) =>
    apiFetchJson<CrmBannerAiResultDTO>(
      `${base(workspaceId)}/ai`,
      'POST',
      brief,
      'A IA não conseguiu responder agora',
    ),
})

export function useCrmBanners(workspaceId: string) {
  return useQuery({
    queryKey: crmBannersKeys.list(workspaceId),
    queryFn: () => crmBannersApi(workspaceId).list(),
  })
}

export function useCrmBanner(workspaceId: string, bannerId: string) {
  return useQuery({
    queryKey: crmBannersKeys.detail(workspaceId, bannerId),
    queryFn: () => crmBannersApi(workspaceId).get(bannerId),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Invalidates the list after any change of the library. */
export function useInvalidateCrmBanners(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: crmBannersKeys.list(workspaceId),
    })
}

export function useDuplicateCrmBanner(workspaceId: string) {
  const invalidate = useInvalidateCrmBanners(workspaceId)
  return useMutation({
    mutationFn: (bannerId: string) =>
      crmBannersApi(workspaceId).duplicate(bannerId),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteCrmBanner(workspaceId: string) {
  const invalidate = useInvalidateCrmBanners(workspaceId)
  return useMutation({
    mutationFn: (bannerId: string) =>
      crmBannersApi(workspaceId).remove(bannerId),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateCrmBannerMeta(workspaceId: string) {
  const invalidate = useInvalidateCrmBanners(workspaceId)
  return useMutation({
    mutationFn: (input: { bannerId: string; data: UpdateCrmBannerDTO }) =>
      crmBannersApi(workspaceId).update(input.bannerId, input.data),
    onSuccess: () => invalidate(),
  })
}
