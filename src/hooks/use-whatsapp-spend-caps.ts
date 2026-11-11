import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateWhatsAppSpendCapDTO } from '@/src/schemas/whatsapp-spend-cap.schema'
import type { WhatsAppSpendCapStatusDTO } from '@/types/whatsapp-spend-cap'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/costs/spend-caps`

export const WHATSAPP_SPEND_CAPS_KEY = (workspaceId: string) =>
  ['whatsapp-spend-caps', workspaceId] as const

/**
 * Month spend (read from Meta on access, 60 s server cache) and the cap of
 * each Meta number — ADR 0064. OWNER/ADMIN only (the API refuses others).
 */
export function useWhatsAppSpendCaps(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_SPEND_CAPS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSpendCapStatusDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar o gasto dos números na Meta',
      ),
    enabled,
    staleTime: 60 * 1000,
    retry: false,
  })
}

export function useUpdateWhatsAppSpendCap(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      connectionId,
      ...data
    }: UpdateWhatsAppSpendCapDTO & { connectionId: string }) =>
      apiFetchJson<WhatsAppSpendCapStatusDTO>(
        `${base(workspaceId)}/${connectionId}`,
        'PUT',
        data,
        'Erro ao salvar o limite de gasto',
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData<WhatsAppSpendCapStatusDTO[]>(
        WHATSAPP_SPEND_CAPS_KEY(workspaceId),
        (current) =>
          current?.map((row) =>
            row.connectionId === saved.connectionId ? saved : row,
          ) ?? [saved],
      )
    },
  })
}
