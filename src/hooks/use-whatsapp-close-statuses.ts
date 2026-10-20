import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  WhatsAppCloseOutcomeDTO,
  WhatsAppCloseStatusDTO,
  WhatsAppCloseStatusOptionsDTO,
} from '@/types/whatsapp-close-status'
import { apiFetch } from './_fetch'

const CLOSE_STATUSES_KEY = (workspaceId: string) =>
  ['whatsapp-close-statuses', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/close-statuses`

/** Options of the close dialog + how many the agent picks. */
export function useWhatsAppCloseStatuses(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: CLOSE_STATUSES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppCloseStatusOptionsDTO>(
        base(workspaceId),
        undefined,
        'Erro ao buscar os status de fechamento',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

function useInvalidateCloseStatuses(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: CLOSE_STATUSES_KEY(workspaceId),
    })
}

export function useCreateWhatsAppCloseStatus(workspaceId: string) {
  const invalidate = useInvalidateCloseStatuses(workspaceId)
  return useMutation({
    mutationFn: (data: { label: string; outcome: WhatsAppCloseOutcomeDTO }) =>
      apiFetch<WhatsAppCloseStatusDTO>(
        base(workspaceId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar o status de fechamento',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateWhatsAppCloseStatus(workspaceId: string) {
  const invalidate = useInvalidateCloseStatuses(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      label?: string
      outcome?: WhatsAppCloseOutcomeDTO
      position?: number
    }) =>
      apiFetch<WhatsAppCloseStatusDTO>(
        `${base(workspaceId)}/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar o status de fechamento',
      ),
    onSuccess: invalidate,
  })
}

export function useArchiveWhatsAppCloseStatus(workspaceId: string) {
  const invalidate = useInvalidateCloseStatuses(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(
        `${base(workspaceId)}/${id}`,
        { method: 'DELETE' },
        'Erro ao remover o status de fechamento',
      ),
    onSuccess: invalidate,
  })
}

/** After saving the min/max rules (settings), refresh the dialog options. */
export function useRefreshWhatsAppCloseStatuses(workspaceId: string) {
  return useInvalidateCloseStatuses(workspaceId)
}
