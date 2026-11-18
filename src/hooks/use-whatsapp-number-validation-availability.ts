import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './_fetch'

/**
 * Where a "tem WhatsApp?" check would run: the workspace's own connected Z-API
 * (`WORKSPACE`), the server's shared instance (`PLATFORM`) or nowhere (`null`).
 */
export type NumberValidationSourceKind = 'WORKSPACE' | 'PLATFORM'

export interface NumberValidationAvailabilityDTO {
  available: boolean
  source: NumberValidationSourceKind | null
}

const AVAILABILITY_KEY = (workspaceId: string) =>
  ['whatsapp-number-validation-availability', workspaceId] as const

/** Whether the workspace can validate numbers, and through which instance. */
export function useNumberValidationAvailability(workspaceId: string) {
  return useQuery({
    queryKey: AVAILABILITY_KEY(workspaceId),
    queryFn: () =>
      apiFetch<NumberValidationAvailabilityDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/number-validation/availability`,
        undefined,
        'Erro ao verificar a disponibilidade da validação de números',
      ),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(workspaceId),
  })
}
