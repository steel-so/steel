'use client'

import { useQuery } from '@tanstack/react-query'
import type { AdminServerDTO } from '@/types/admin-server'
import { apiFetch } from './_fetch'

export const SERVER_POLL_MS = 5000

/** Server snapshot, polled every 5 s unless `paused`. */
export function useAdminServer(paused = false) {
  return useQuery({
    queryKey: ['admin', 'server'] as const,
    queryFn: () =>
      apiFetch<AdminServerDTO>(
        '/api/admin/server',
        undefined,
        'Erro ao carregar os dados do servidor',
      ),
    refetchInterval: paused ? false : SERVER_POLL_MS,
    refetchIntervalInBackground: false,
  })
}
