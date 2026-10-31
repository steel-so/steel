import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  QaConfigDTO,
  QaCoachingDTO,
  QaReviewDTO,
  QaReviewListDTO,
  QaReviewStatusDTO,
  QaSubjectTypeDTO,
} from '@/types/qa-review'
import { apiFetch } from './_fetch'

const CONFIG_KEY = (workspaceId: string) => ['qa-config', workspaceId] as const

export function useQaConfig(workspaceId: string) {
  return useQuery({
    queryKey: CONFIG_KEY(workspaceId),
    queryFn: () =>
      apiFetch<QaConfigDTO>(
        `/api/workspaces/${workspaceId}/qa/config`,
        undefined,
        'Erro ao buscar a configuração do QA',
      ),
    staleTime: 60 * 1000,
  })
}

export type QaConfigInput = Partial<
  Omit<QaConfigDTO, 'criteria'> & {
    criteria: Omit<QaConfigDTO['criteria'][number], 'position'>[]
  }
>

export function useUpdateQaConfig(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: QaConfigInput) =>
      apiFetch<QaConfigDTO>(
        `/api/workspaces/${workspaceId}/qa/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar a configuração do QA',
      ),
    onSuccess: (config) => {
      queryClient.setQueryData(CONFIG_KEY(workspaceId), config)
    },
  })
}

export interface QaReviewsParams {
  subjectType?: QaSubjectTypeDTO
  status?: QaReviewStatusDTO
  agentUserId?: string
  lowOnly?: boolean
  cursor?: string
}

export function useQaReviews(workspaceId: string, params: QaReviewsParams) {
  return useQuery({
    queryKey: ['qa-reviews', workspaceId, params] as const,
    queryFn: () => {
      const query = new URLSearchParams({ limit: '15' })
      if (params.subjectType) query.set('subjectType', params.subjectType)
      if (params.status) query.set('status', params.status)
      if (params.agentUserId) query.set('agentUserId', params.agentUserId)
      if (params.lowOnly) query.set('lowOnly', 'true')
      if (params.cursor) query.set('cursor', params.cursor)
      return apiFetch<QaReviewListDTO>(
        `/api/workspaces/${workspaceId}/qa/reviews?${query}`,
        undefined,
        'Erro ao buscar as avaliações',
      )
    },
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })
}

export function useQaReview(workspaceId: string, reviewId: string | null) {
  return useQuery({
    queryKey: ['qa-review', workspaceId, reviewId] as const,
    enabled: !!reviewId,
    queryFn: () =>
      apiFetch<QaReviewDTO>(
        `/api/workspaces/${workspaceId}/qa/reviews/${reviewId}`,
        undefined,
        'Erro ao buscar a avaliação',
      ),
    staleTime: 30 * 1000,
  })
}

export function useQaCoaching(
  workspaceId: string,
  params: { from?: string; to?: string; agentUserId?: string },
) {
  return useQuery({
    queryKey: ['qa-coaching', workspaceId, params] as const,
    queryFn: () => {
      const query = new URLSearchParams()
      if (params.from) query.set('from', params.from)
      if (params.to) query.set('to', params.to)
      if (params.agentUserId) query.set('agentUserId', params.agentUserId)
      return apiFetch<QaCoachingDTO>(
        `/api/workspaces/${workspaceId}/qa/coaching?${query}`,
        undefined,
        'Erro ao buscar o painel de coaching',
      )
    },
    staleTime: 30 * 1000,
  })
}

export function useRequestQaReview(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { subjectType: QaSubjectTypeDTO; subjectId: string }) =>
      apiFetch<QaReviewDTO>(
        `/api/workspaces/${workspaceId}/qa/reviews`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao pedir a avaliação',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qa-reviews', workspaceId] })
    },
  })
}
