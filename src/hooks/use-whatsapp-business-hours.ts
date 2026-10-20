import { useQuery } from '@tanstack/react-query'
import type { WhatsAppBusinessHoursStatusDTO } from '@/types/whatsapp-business-hours'
import { apiFetch } from './_fetch'

export const WHATSAPP_BUSINESS_HOURS_KEY = (workspaceId: string) =>
  ['whatsapp-business-hours', workspaceId] as const

/** Re-checks every minute so the lock lifts on its own at the opening. */
export function useWhatsAppBusinessHours(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_BUSINESS_HOURS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppBusinessHoursStatusDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/business-hours`,
        undefined,
        'Erro ao buscar o horário de atendimento',
      ),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })
}
