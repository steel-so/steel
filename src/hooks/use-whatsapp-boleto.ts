import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppBoletoChargeDTO,
  UpdateWhatsAppBoletoSettingsDTO,
} from '@/src/schemas/whatsapp-boleto.schema'
import type {
  WhatsAppBoletoChargeDTO,
  WhatsAppBoletoSettingsDTO,
} from '@/types/whatsapp-boleto'
import { apiFetch, apiFetchJson } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-boleto-settings', workspaceId] as const

/** Prefix shared with the realtime invalidation (`use-whatsapp-events`). */
export const WHATSAPP_BOLETO_CHARGES_KEY = (
  workspaceId: string,
  conversationId: string,
) => ['whatsapp-boleto-charges', workspaceId, conversationId] as const

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}`

/** A pending boleto is polled this often until a payment notice lands. */
const PENDING_POLL_MS = 60_000

/** Create input as the form sends it: `dueInDays` falls back to the default. */
export type CreateWhatsAppBoletoChargeInput = Omit<
  CreateWhatsAppBoletoChargeDTO,
  'dueInDays'
> & { dueInDays?: number }

/** Boleto switch of the workspace (any module member reads it). */
export function useWhatsAppBoletoSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppBoletoSettingsDTO>(
        `${base(workspaceId)}/whatsapp/boleto/settings`,
        undefined,
        'Erro ao buscar as configurações do boleto',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppBoletoSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppBoletoSettingsDTO) =>
      apiFetchJson<WhatsAppBoletoSettingsDTO>(
        `${base(workspaceId)}/whatsapp/boleto/settings`,
        'PATCH',
        data,
        'Erro ao salvar as configurações do boleto',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useWhatsAppBoletoCharges(
  workspaceId: string,
  conversationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: WHATSAPP_BOLETO_CHARGES_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppBoletoChargeDTO[]>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/boleto`,
        undefined,
        'Erro ao buscar os boletos',
      ),
    enabled: enabled && Boolean(workspaceId && conversationId),
    // The SSE stream pushes the payment; the poll only covers a dropped one.
    refetchInterval: (query) =>
      query.state.data?.some((charge) => charge.status === 'PENDING')
        ? PENDING_POLL_MS
        : false,
  })
}

function useInvalidateCharges(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: WHATSAPP_BOLETO_CHARGES_KEY(workspaceId, conversationId),
    })
    queryClient.invalidateQueries({
      queryKey: ['whatsapp-messages', workspaceId, conversationId],
    })
  }
}

export function useCreateWhatsAppBoletoCharge(
  workspaceId: string,
  conversationId: string,
) {
  const invalidate = useInvalidateCharges(workspaceId, conversationId)
  return useMutation({
    mutationFn: (data: CreateWhatsAppBoletoChargeInput) =>
      apiFetchJson<WhatsAppBoletoChargeDTO>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/boleto`,
        'POST',
        data,
        'Erro ao enviar o boleto',
      ),
    onSuccess: invalidate,
  })
}

export function useCancelWhatsAppBoletoCharge(
  workspaceId: string,
  conversationId: string,
) {
  const invalidate = useInvalidateCharges(workspaceId, conversationId)
  return useMutation({
    mutationFn: (chargeId: string) =>
      apiFetch<WhatsAppBoletoChargeDTO>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/boleto/${chargeId}`,
        { method: 'DELETE' },
        'Erro ao cancelar o boleto',
      ),
    onSuccess: invalidate,
  })
}
