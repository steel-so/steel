import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppAdSpendDTO,
  UpdateWhatsAppAdSettingsDTO,
} from '@/src/schemas/whatsapp-ad.schema'
import type {
  WhatsAppAdReferralDTO,
  WhatsAppAdReportDTO,
  WhatsAppAdSettingsDTO,
  WhatsAppAdSpendDTO,
} from '@/types/whatsapp-ad'
import { apiFetch, apiFetchJson } from './_fetch'

export interface WhatsAppAdFilters {
  from: string
  to: string
}

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/ads`

export const WHATSAPP_AD_REPORT_KEY = (
  workspaceId: string,
  filters?: WhatsAppAdFilters,
) => ['whatsapp-ads', workspaceId, filters ?? null] as const

export const WHATSAPP_AD_SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-ads-settings', workspaceId] as const

export const WHATSAPP_AD_SPENDS_KEY = (workspaceId: string) =>
  ['whatsapp-ads-spends', workspaceId] as const

export const WHATSAPP_AD_REFERRAL_KEY = (
  workspaceId: string,
  conversationId: string,
) => ['whatsapp-ad-referral', workspaceId, conversationId] as const

function query(filters: WhatsAppAdFilters): string {
  return new URLSearchParams({
    from: filters.from,
    to: filters.to,
  }).toString()
}

/** Download link of the CSV for the same filters (the API sets the headers). */
export function whatsappAdExportUrl(
  workspaceId: string,
  filters: WhatsAppAdFilters,
): string {
  return `${base(workspaceId)}/export?${query(filters)}`
}

export function useWhatsAppAdReport(
  workspaceId: string,
  filters: WhatsAppAdFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: WHATSAPP_AD_REPORT_KEY(workspaceId, filters),
    queryFn: () =>
      apiFetch<WhatsAppAdReportDTO>(
        `${base(workspaceId)}?${query(filters)}`,
        undefined,
        'Erro ao buscar o relatório de anúncios',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useWhatsAppAdSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_AD_SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAdSettingsDTO>(
        `${base(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar a configuração dos anúncios',
      ),
    enabled,
  })
}

export function useUpdateWhatsAppAdSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppAdSettingsDTO) =>
      apiFetchJson<WhatsAppAdSettingsDTO>(
        `${base(workspaceId)}/settings`,
        'PATCH',
        data,
        'Erro ao salvar a configuração dos anúncios',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(WHATSAPP_AD_SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useWhatsAppAdSpends(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_AD_SPENDS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAdSpendDTO[]>(
        `${base(workspaceId)}/spends`,
        undefined,
        'Erro ao buscar os gastos com anúncios',
      ),
    enabled,
  })
}

function invalidateSpendViews(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  queryClient.invalidateQueries({
    queryKey: WHATSAPP_AD_SPENDS_KEY(workspaceId),
  })
  // The report carries the spend and the ROI.
  queryClient.invalidateQueries({ queryKey: ['whatsapp-ads', workspaceId] })
}

export function useCreateWhatsAppAdSpend(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWhatsAppAdSpendDTO) =>
      apiFetchJson<WhatsAppAdSpendDTO>(
        `${base(workspaceId)}/spends`,
        'POST',
        data,
        'Erro ao lançar o gasto',
      ),
    onSuccess: () => invalidateSpendViews(queryClient, workspaceId),
  })
}

export function useDeleteWhatsAppAdSpend(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (spendId: string) =>
      apiFetchJson<{ id: string }>(
        `${base(workspaceId)}/spends/${spendId}`,
        'DELETE',
        undefined,
        'Erro ao excluir o gasto',
      ),
    onSuccess: () => invalidateSpendViews(queryClient, workspaceId),
  })
}

/** The ad that opened a conversation; `null` for an ordinary one. */
export function useWhatsAppConversationAdReferral(
  workspaceId: string,
  conversationId: string,
) {
  return useQuery({
    queryKey: WHATSAPP_AD_REFERRAL_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppAdReferralDTO | null>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/ad-referral`,
        undefined,
        'Erro ao buscar a origem da conversa',
      ),
    staleTime: 5 * 60 * 1000,
  })
}
