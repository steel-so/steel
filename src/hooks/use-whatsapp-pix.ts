import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppPixChargeDTO,
  UpdateWhatsAppPixSettingsDTO,
} from '@/src/schemas/whatsapp-pix.schema'
import type {
  WhatsAppPixChargeDTO,
  WhatsAppPixSettingsDTO,
} from '@/types/whatsapp-pix'
import { apiFetch, apiFetchJson } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-pix-settings', workspaceId] as const

/** Prefix shared with the realtime invalidation (`use-whatsapp-events`). */
export const WHATSAPP_PIX_CHARGES_KEY = (
  workspaceId: string,
  conversationId: string,
) => ['whatsapp-pix-charges', workspaceId, conversationId] as const

export const CRM_OPPORTUNITY_PIX_KEY = (
  workspaceId: string,
  opportunityId: string,
) => ['crm-opportunity-pix', workspaceId, opportunityId] as const

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}`

/** A pending charge is polled this often until a payment notice lands. */
const PENDING_POLL_MS = 30_000

/** Pix switch and defaults of the workspace (any module member reads it). */
export function useWhatsAppPixSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppPixSettingsDTO>(
        `${base(workspaceId)}/whatsapp/pix/settings`,
        undefined,
        'Erro ao buscar as configurações do Pix',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppPixSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppPixSettingsDTO) =>
      apiFetchJson<WhatsAppPixSettingsDTO>(
        `${base(workspaceId)}/whatsapp/pix/settings`,
        'PATCH',
        data,
        'Erro ao salvar as configurações do Pix',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useWhatsAppPixCharges(
  workspaceId: string,
  conversationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: WHATSAPP_PIX_CHARGES_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppPixChargeDTO[]>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/pix`,
        undefined,
        'Erro ao buscar as cobranças Pix',
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
      queryKey: WHATSAPP_PIX_CHARGES_KEY(workspaceId, conversationId),
    })
    queryClient.invalidateQueries({
      queryKey: ['whatsapp-conversation-events', workspaceId, conversationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['whatsapp-messages', workspaceId, conversationId],
    })
  }
}

export function useCreateWhatsAppPixCharge(
  workspaceId: string,
  conversationId: string,
) {
  const invalidate = useInvalidateCharges(workspaceId, conversationId)
  return useMutation({
    mutationFn: (data: CreateWhatsAppPixChargeDTO) =>
      apiFetchJson<WhatsAppPixChargeDTO>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/pix`,
        'POST',
        data,
        'Erro ao enviar a cobrança Pix',
      ),
    onSuccess: invalidate,
  })
}

export function useCancelWhatsAppPixCharge(
  workspaceId: string,
  conversationId: string,
) {
  const invalidate = useInvalidateCharges(workspaceId, conversationId)
  return useMutation({
    mutationFn: (chargeId: string) =>
      apiFetch<WhatsAppPixChargeDTO>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/pix/${chargeId}`,
        { method: 'DELETE' },
        'Erro ao cancelar a cobrança Pix',
      ),
    onSuccess: invalidate,
  })
}

/** Test providers only: pays the charge as if the customer had. */
export function useSimulateWhatsAppPixPayment(
  workspaceId: string,
  conversationId: string,
) {
  const invalidate = useInvalidateCharges(workspaceId, conversationId)
  return useMutation({
    mutationFn: (chargeId: string) =>
      apiFetch<WhatsAppPixChargeDTO>(
        `${base(workspaceId)}/whatsapp/conversations/${conversationId}/pix/${chargeId}/simulate-payment`,
        { method: 'POST' },
        'Erro ao simular o pagamento',
      ),
    onSuccess: invalidate,
  })
}

/** Charges sent for a CRM deal (CRM members). */
export function useCrmOpportunityPix(
  workspaceId: string,
  opportunityId: string,
) {
  return useQuery({
    queryKey: CRM_OPPORTUNITY_PIX_KEY(workspaceId, opportunityId),
    queryFn: () =>
      apiFetch<WhatsAppPixChargeDTO[]>(
        `${base(workspaceId)}/crm/opportunities/${opportunityId}/pix`,
        undefined,
        'Erro ao buscar as cobranças Pix da oportunidade',
      ),
    enabled: Boolean(workspaceId && opportunityId),
  })
}

export interface PixOpportunityOption {
  id: string
  name: string
}

/**
 * Deals the charge can be linked to. Members without the CRM module get a
 * 403 here: the query then stays empty and the picker is simply not shown.
 */
export function useWhatsAppPixOpportunityOptions(
  workspaceId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['whatsapp-pix-opportunity-options', workspaceId],
    queryFn: async () => {
      const list = await apiFetch<PixOpportunityOption[]>(
        `${base(workspaceId)}/crm/opportunities`,
        undefined,
        'Erro ao buscar oportunidades',
      )
      return list.map(({ id, name }) => ({ id, name }))
    },
    enabled: enabled && Boolean(workspaceId),
    retry: false,
    staleTime: 60 * 1000,
  })
}
