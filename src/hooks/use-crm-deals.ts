'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  UpdateCrmDealsSettingsDTO,
  UpsertCrmDealRoomInput,
} from '@/src/schemas/crm-deals.schema'
import type {
  CrmContractDTO,
  CrmContractStatusDTO,
  CrmDealRoomDTO,
  CrmDealsSettingsDTO,
  CrmProposalChargeDTO,
  CrmProposalCheckoutDTO,
  CrmRenewalScanResultDTO,
  CrmUpsellDTO,
  DealRoomMessageDTO,
} from '@/types/crm-deals'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * CRM deal tools (nov: crm-deals): proposal charge and signature (C6), the
 * negotiation room (C8) and contract renewals / upsell (C9).
 */

const base = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}/crm`

export const crmDealsKeys = {
  settings: (ws: string) => ['crm-deals', ws, 'settings'] as const,
  checkout: (ws: string, proposalId: string) =>
    ['crm-deals', ws, 'checkout', proposalId] as const,
  room: (ws: string, opportunityId: string) =>
    ['crm-deals', ws, 'room', opportunityId] as const,
  messages: (ws: string, opportunityId: string) =>
    ['crm-deals', ws, 'room-messages', opportunityId] as const,
  contracts: (ws: string) => ['crm-deals', ws, 'contracts'] as const,
  upsell: (ws: string, companyId: string) =>
    ['crm-deals', ws, 'upsell', companyId] as const,
}

// ─── settings ───────────────────────────────────────────────────────────────

export function useCrmDealsSettings(workspaceId: string) {
  return useQuery({
    queryKey: crmDealsKeys.settings(workspaceId),
    queryFn: () =>
      apiFetch<CrmDealsSettingsDTO>(
        `${base(workspaceId)}/deals-settings`,
        undefined,
        'Erro ao buscar as configurações',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useUpdateCrmDealsSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCrmDealsSettingsDTO) =>
      apiFetchJson<CrmDealsSettingsDTO>(
        `${base(workspaceId)}/deals-settings`,
        'PATCH',
        input,
        'Erro ao salvar as configurações',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(crmDealsKeys.settings(workspaceId), data)
    },
  })
}

// ─── C6 · proposal charge and signature ─────────────────────────────────────

export function useProposalCheckout(
  workspaceId: string,
  proposalId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: crmDealsKeys.checkout(workspaceId, proposalId),
    queryFn: () =>
      apiFetch<CrmProposalCheckoutDTO>(
        `${base(workspaceId)}/proposals/${proposalId}/checkout`,
        undefined,
        'Erro ao buscar as cobranças da proposta',
      ),
    enabled: enabled && Boolean(workspaceId) && Boolean(proposalId),
    // The customer may pay at any moment.
    refetchInterval: 15_000,
  })
}

export function useCreateProposalCharge(
  workspaceId: string,
  proposalId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      method: 'PIX' | 'BOLETO'
      amount?: number
      description?: string
      expiresInDays: number
    }) =>
      apiFetchJson<CrmProposalChargeDTO>(
        `${base(workspaceId)}/proposals/${proposalId}/charges`,
        'POST',
        input,
        'Erro ao criar a cobrança',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.checkout(workspaceId, proposalId),
      }),
  })
}

export function useCancelProposalCharge(
  workspaceId: string,
  proposalId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (chargeId: string) =>
      apiFetchJson<CrmProposalChargeDTO>(
        `${base(workspaceId)}/proposals/${proposalId}/charges/${chargeId}`,
        'DELETE',
        undefined,
        'Erro ao cancelar a cobrança',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.checkout(workspaceId, proposalId),
      }),
  })
}

export function useSimulateProposalPayment(
  workspaceId: string,
  proposalId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (chargeId: string) =>
      apiFetchJson<CrmProposalChargeDTO>(
        `${base(workspaceId)}/proposals/${proposalId}/charges/${chargeId}/simulate`,
        'POST',
        {},
        'Erro ao simular o pagamento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.checkout(workspaceId, proposalId),
      }),
  })
}

// ─── C8 · deal room ─────────────────────────────────────────────────────────

export function useDealRoom(workspaceId: string, opportunityId: string) {
  return useQuery({
    queryKey: crmDealsKeys.room(workspaceId, opportunityId),
    queryFn: () =>
      apiFetch<CrmDealRoomDTO | null>(
        `${base(workspaceId)}/opportunities/${opportunityId}/room`,
        undefined,
        'Erro ao buscar a sala de negociação',
      ),
    enabled: Boolean(workspaceId) && Boolean(opportunityId),
    refetchInterval: 20_000,
  })
}

export function useUpsertDealRoom(workspaceId: string, opportunityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertCrmDealRoomInput) =>
      apiFetchJson<CrmDealRoomDTO>(
        `${base(workspaceId)}/opportunities/${opportunityId}/room`,
        'PUT',
        input,
        'Erro ao salvar a sala de negociação',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        crmDealsKeys.room(workspaceId, opportunityId),
        data,
      )
    },
  })
}

export function useDealRoomMessages(
  workspaceId: string,
  opportunityId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmDealsKeys.messages(workspaceId, opportunityId),
    queryFn: () =>
      apiFetch<DealRoomMessageDTO[]>(
        `${base(workspaceId)}/opportunities/${opportunityId}/room/messages`,
        undefined,
        'Erro ao buscar a conversa da sala',
      ),
    enabled: enabled && Boolean(workspaceId) && Boolean(opportunityId),
    refetchInterval: 10_000,
  })
}

export function usePostDealRoomMessage(
  workspaceId: string,
  opportunityId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      apiFetchJson<DealRoomMessageDTO>(
        `${base(workspaceId)}/opportunities/${opportunityId}/room/messages`,
        'POST',
        { body },
        'Erro ao enviar a mensagem',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.messages(workspaceId, opportunityId),
      }),
  })
}

// ─── C9 · contracts and upsell ──────────────────────────────────────────────

export function useCrmContracts(
  workspaceId: string,
  status?: CrmContractStatusDTO,
) {
  return useQuery({
    queryKey: [...crmDealsKeys.contracts(workspaceId), status ?? 'all'],
    queryFn: () =>
      apiFetch<CrmContractDTO[]>(
        `${base(workspaceId)}/contracts${status ? `?status=${status}` : ''}`,
        undefined,
        'Erro ao buscar os contratos',
      ),
    enabled: Boolean(workspaceId),
  })
}

export interface CrmContractInput {
  name: string
  companyId: string
  value?: number | null
  startDate: string
  endDate: string
  autoRenews: boolean
  notes?: string | null
}

export function useCreateCrmContract(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CrmContractInput) =>
      apiFetchJson<CrmContractDTO>(
        `${base(workspaceId)}/contracts`,
        'POST',
        input,
        'Erro ao cadastrar o contrato',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.contracts(workspaceId),
      }),
  })
}

export function useUpdateCrmContract(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      patch: Partial<{
        name: string
        value: number | null
        endDate: string
        autoRenews: boolean
        status: CrmContractStatusDTO
        notes: string | null
      }>
    }) =>
      apiFetchJson<CrmContractDTO>(
        `${base(workspaceId)}/contracts/${input.id}`,
        'PATCH',
        input.patch,
        'Erro ao salvar o contrato',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.contracts(workspaceId),
      }),
  })
}

export function useDeleteCrmContract(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<{ deleted: true }>(
        `${base(workspaceId)}/contracts/${id}`,
        'DELETE',
        undefined,
        'Erro ao remover o contrato',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.contracts(workspaceId),
      }),
  })
}

export function useRenewCrmContract(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<CrmContractDTO>(
        `${base(workspaceId)}/contracts/${id}/renew`,
        'POST',
        {},
        'Erro ao abrir a renovação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.contracts(workspaceId),
      }),
  })
}

export function useScanCrmRenewals(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<CrmRenewalScanResultDTO>(
        `${base(workspaceId)}/contracts/scan`,
        'POST',
        {},
        'Erro ao rodar a varredura',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmDealsKeys.contracts(workspaceId),
      }),
  })
}

export function useCrmUpsell(
  workspaceId: string,
  companyId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmDealsKeys.upsell(workspaceId, companyId),
    queryFn: () =>
      apiFetch<CrmUpsellDTO>(
        `${base(workspaceId)}/companies/${companyId}/upsell`,
        undefined,
        'Erro ao buscar as sugestões',
      ),
    enabled: enabled && Boolean(workspaceId) && Boolean(companyId),
    staleTime: 60_000,
  })
}
