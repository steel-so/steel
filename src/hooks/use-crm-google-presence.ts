'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import type {
  CrmGoogleConnectionDTO,
  CrmGoogleLocationOptionDTO,
  GoogleAttributeDTO,
  GoogleCategoryDTO,
  GoogleDescriptionSuggestionDTO,
  GoogleKeywordDTO,
  GoogleLinksDTO,
  GooglePerformanceDTO,
  GooglePerformanceRange,
  GooglePhotoDTO,
  GoogleProfileDTO,
  GoogleReviewDTO,
  GoogleReviewSuggestionDTO,
  GoogleReviewsPageDTO,
  GoogleReviewsSummaryDTO,
  ListGoogleReviewsQuery,
  SelectGoogleLocationDTO,
  UpdateGoogleAttributesDTO,
  UpdateGoogleProfileDTO,
  UpdateGoogleSettingsDTO,
} from '@/src/schemas/crm-google-presence.schema'
import { apiFetch, apiFetchJson, isApiErrorCode } from './_fetch'

/**
 * CRM > Atrair > Presença no Google. The connection is per workspace; the
 * profile, links and attributes are read live from Google, while reviews and
 * performance come from the cache the worker keeps warm.
 */

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/google`

export const crmGoogleKeys = {
  all: (ws: string) => ['crm-google', ws] as const,
  connection: (ws: string) => ['crm-google', ws, 'connection'] as const,
  locations: (ws: string) => ['crm-google', ws, 'locations'] as const,
  profile: (ws: string) => ['crm-google', ws, 'profile'] as const,
  attributes: (ws: string) => ['crm-google', ws, 'attributes'] as const,
  photos: (ws: string) => ['crm-google', ws, 'photos'] as const,
  links: (ws: string) => ['crm-google', ws, 'links'] as const,
  performance: (ws: string, range: GooglePerformanceRange) =>
    ['crm-google', ws, 'performance', range] as const,
  keywords: (ws: string) => ['crm-google', ws, 'keywords'] as const,
  reviews: (ws: string) => ['crm-google', ws, 'reviews'] as const,
  reviewsSummary: (ws: string) =>
    ['crm-google', ws, 'reviews-summary'] as const,
}

/** Codes that mean "connect (or reconnect) the Google account". */
export const GOOGLE_RECONNECT_CODES = [
  'CRM_SOCIAL_CONNECTION_NOT_FOUND',
  'CRM_SOCIAL_TOKEN_EXPIRED',
  'CRM_SOCIAL_SCOPE_MISSING',
]

/**
 * When a Google call fails because the access is gone (expired, revoked, scope
 * missing), refreshes the connection so the gate shows the reconnect screen
 * instead of an error on every card.
 */
export function useReconnectOnAuthError(workspaceId: string, error: unknown) {
  const queryClient = useQueryClient()
  const needsReconnect = isApiErrorCode(error, ...GOOGLE_RECONNECT_CODES)
  useEffect(() => {
    if (needsReconnect) {
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.connection(workspaceId),
      })
    }
  }, [needsReconnect, queryClient, workspaceId])
}

export function useCrmGoogleConnection(workspaceId: string) {
  return useQuery({
    queryKey: crmGoogleKeys.connection(workspaceId),
    queryFn: () =>
      apiFetch<CrmGoogleConnectionDTO>(
        `${base(workspaceId)}/connection`,
        undefined,
        'Erro ao buscar a conexão com o Google',
      ),
    staleTime: 30_000,
  })
}

export function useCrmGoogleLocations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.locations(workspaceId),
    queryFn: () =>
      apiFetch<CrmGoogleLocationOptionDTO[]>(
        `${base(workspaceId)}/locations`,
        undefined,
        'Erro ao buscar os locais do Google',
      ),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
}

export function useSelectGoogleLocation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: SelectGoogleLocationDTO) =>
      apiFetchJson<CrmGoogleConnectionDTO>(
        `${base(workspaceId)}/location`,
        'PUT',
        data,
        'Erro ao escolher o local',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.all(workspaceId),
      }),
  })
}

export function useUpdateGoogleSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateGoogleSettingsDTO) =>
      apiFetchJson<CrmGoogleConnectionDTO>(
        `${base(workspaceId)}/connection`,
        'PATCH',
        data,
        'Erro ao salvar o tom de voz',
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(crmGoogleKeys.connection(workspaceId), data),
  })
}

export function useDisconnectGoogle(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<null>(
        `${base(workspaceId)}/connection`,
        'DELETE',
        undefined,
        'Erro ao desconectar o Google',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.all(workspaceId),
      }),
  })
}

/* Profile ----------------------------------------------------------- */

export function useCrmGoogleProfile(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.profile(workspaceId),
    queryFn: () =>
      apiFetch<GoogleProfileDTO>(
        `${base(workspaceId)}/profile`,
        undefined,
        'Erro ao buscar o perfil no Google',
      ),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

export function useUpdateGoogleProfile(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateGoogleProfileDTO) =>
      apiFetchJson<GoogleProfileDTO>(
        `${base(workspaceId)}/profile`,
        'PATCH',
        data,
        'Erro ao salvar o perfil no Google',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(crmGoogleKeys.profile(workspaceId), data)
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.connection(workspaceId),
      })
    },
  })
}

export function useSearchGoogleCategories(workspaceId: string, term: string) {
  const trimmed = term.trim()
  return useQuery({
    queryKey: [...crmGoogleKeys.all(workspaceId), 'categories', trimmed],
    queryFn: () =>
      apiFetch<GoogleCategoryDTO[]>(
        `${base(workspaceId)}/profile/categories?q=${encodeURIComponent(trimmed)}`,
        undefined,
        'Erro ao buscar categorias',
      ),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useCrmGoogleAttributes(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.attributes(workspaceId),
    queryFn: () =>
      apiFetch<GoogleAttributeDTO[]>(
        `${base(workspaceId)}/profile/attributes`,
        undefined,
        'Erro ao buscar os atributos',
      ),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
}

export function useUpdateGoogleAttributes(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateGoogleAttributesDTO) =>
      apiFetchJson<null>(
        `${base(workspaceId)}/profile/attributes`,
        'PATCH',
        data,
        'Erro ao salvar os atributos',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.attributes(workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.profile(workspaceId),
      })
    },
  })
}

export function useCrmGooglePhotos(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.photos(workspaceId),
    queryFn: () =>
      apiFetch<GooglePhotoDTO[]>(
        `${base(workspaceId)}/profile/photos`,
        undefined,
        'Erro ao buscar as fotos',
      ),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

export function useUploadGooglePhoto(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, category }: { file: File; category: string }) => {
      const form = new FormData()
      form.set('file', file)
      form.set('category', category)
      return apiFetch<null>(
        `${base(workspaceId)}/profile/photos`,
        { method: 'POST', body: form },
        'Erro ao enviar a foto',
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.photos(workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.profile(workspaceId),
      })
    },
  })
}

export function useDeleteGooglePhoto(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetchJson<null>(
        `${base(workspaceId)}/profile/photos`,
        'DELETE',
        { name },
        'Erro ao remover a foto',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.photos(workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: crmGoogleKeys.profile(workspaceId),
      })
    },
  })
}

export function useSuggestGoogleDescription(workspaceId: string) {
  return useMutation({
    mutationFn: () =>
      apiFetchJson<GoogleDescriptionSuggestionDTO>(
        `${base(workspaceId)}/profile/description-suggestion`,
        'POST',
        undefined,
        'Erro ao gerar a sugestão',
      ),
  })
}

/* Maps -------------------------------------------------------------- */

export function useCrmGoogleLinks(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.links(workspaceId),
    queryFn: () =>
      apiFetch<GoogleLinksDTO>(
        `${base(workspaceId)}/links`,
        undefined,
        'Erro ao buscar os links do local',
      ),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useCrmGooglePerformance(
  workspaceId: string,
  range: GooglePerformanceRange,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmGoogleKeys.performance(workspaceId, range),
    queryFn: () =>
      apiFetch<GooglePerformanceDTO>(
        `${base(workspaceId)}/performance?range=${range}`,
        undefined,
        'Erro ao buscar o desempenho no Google',
      ),
    enabled,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useCrmGoogleKeywords(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmGoogleKeys.keywords(workspaceId),
    queryFn: () =>
      apiFetch<GoogleKeywordDTO[]>(
        `${base(workspaceId)}/performance/keywords`,
        undefined,
        'Erro ao buscar as palavras de busca',
      ),
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
  })
}

/* Reviews ----------------------------------------------------------- */

export function useCrmGoogleReviews(
  workspaceId: string,
  query: ListGoogleReviewsQuery,
  enabled: boolean,
) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.rating) params.set('rating', String(query.rating))
  if (query.replied) params.set('replied', query.replied)
  if (query.q) params.set('q', query.q)
  return useQuery({
    queryKey: [...crmGoogleKeys.reviews(workspaceId), params.toString()],
    queryFn: () =>
      apiFetch<GoogleReviewsPageDTO>(
        `${base(workspaceId)}/reviews?${params.toString()}`,
        undefined,
        'Erro ao buscar as avaliações',
      ),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useCrmGoogleReviewsSummary(
  workspaceId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmGoogleKeys.reviewsSummary(workspaceId),
    queryFn: () =>
      apiFetch<GoogleReviewsSummaryDTO>(
        `${base(workspaceId)}/reviews/summary`,
        undefined,
        'Erro ao buscar o resumo das avaliações',
      ),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

function invalidateReviews(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  queryClient.invalidateQueries({
    queryKey: crmGoogleKeys.reviews(workspaceId),
  })
  queryClient.invalidateQueries({
    queryKey: crmGoogleKeys.reviewsSummary(workspaceId),
  })
  queryClient.invalidateQueries({
    queryKey: crmGoogleKeys.connection(workspaceId),
  })
}

export function useSyncGoogleReviews(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<{ synced: number; created: number }>(
        `${base(workspaceId)}/reviews/sync`,
        'POST',
        undefined,
        'Erro ao atualizar as avaliações',
      ),
    onSuccess: () => invalidateReviews(queryClient, workspaceId),
  })
}

export function useReplyGoogleReview(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reviewId,
      comment,
    }: {
      reviewId: string
      comment: string
    }) =>
      apiFetchJson<GoogleReviewDTO>(
        `${base(workspaceId)}/reviews/${encodeURIComponent(reviewId)}/reply`,
        'PUT',
        { comment },
        'Erro ao responder a avaliação',
      ),
    onSuccess: () => invalidateReviews(queryClient, workspaceId),
  })
}

export function useDeleteGoogleReviewReply(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewId: string) =>
      apiFetchJson<GoogleReviewDTO>(
        `${base(workspaceId)}/reviews/${encodeURIComponent(reviewId)}/reply`,
        'DELETE',
        undefined,
        'Erro ao apagar a resposta',
      ),
    onSuccess: () => invalidateReviews(queryClient, workspaceId),
  })
}

export function useSuggestGoogleReviewReply(workspaceId: string) {
  return useMutation({
    mutationFn: (reviewId: string) =>
      apiFetchJson<GoogleReviewSuggestionDTO>(
        `${base(workspaceId)}/reviews/${encodeURIComponent(reviewId)}/suggestion`,
        'POST',
        undefined,
        'Erro ao gerar a sugestão',
      ),
  })
}
