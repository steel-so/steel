import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TourProgressDTO } from '@/types/tour-progress'
import type { MarkTourSeenDTO } from '../schemas/tour-progress.schema'
import { apiFetch, apiFetchJson } from './_fetch'

const TOUR_PROGRESS_KEY = ['tour-progress']
const BASE_API_ROUTE = '/api/users/me/tours'

/** Guided tours the session user has already seen. */
export function useTourProgress() {
  return useQuery({
    queryKey: TOUR_PROGRESS_KEY,
    queryFn: () =>
      apiFetch<TourProgressDTO[]>(
        BASE_API_ROUTE,
        undefined,
        'Erro ao buscar os tours',
      ),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useMarkTourSeen() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: MarkTourSeenDTO) =>
      apiFetchJson<TourProgressDTO>(
        BASE_API_ROUTE,
        'PUT',
        data,
        'Erro ao salvar o tour',
      ),
    // Optimistic: the tour must not reopen on the next screen even if the
    // request is still in flight (or fails; it then reopens after a reload).
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: TOUR_PROGRESS_KEY })
      queryClient.setQueryData<TourProgressDTO[]>(
        TOUR_PROGRESS_KEY,
        (previous = []) => [
          ...previous.filter((item) => item.key !== data.key),
          { ...data, seenAt: new Date().toISOString() },
        ],
      )
    },
  })
}
