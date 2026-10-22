import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateWhatsAppPriceDTO } from '@/src/schemas/whatsapp-cost.schema'
import type {
  WhatsAppCostReportDTO,
  WhatsAppCostSettingsDTO,
  WhatsAppPriceDTO,
} from '@/types/whatsapp-cost'
import { apiFetch, apiFetchJson } from './_fetch'

export interface WhatsAppCostFilters {
  from: string
  to: string
  connectionId?: string
}

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/costs`

export const WHATSAPP_COST_KEY = (
  workspaceId: string,
  filters?: WhatsAppCostFilters,
) => ['whatsapp-costs', workspaceId, filters ?? null] as const

export const WHATSAPP_COST_SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-costs-settings', workspaceId] as const

export const WHATSAPP_COST_PRICES_KEY = (workspaceId: string) =>
  ['whatsapp-costs-prices', workspaceId] as const

function query(filters: WhatsAppCostFilters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to })
  if (filters.connectionId) params.set('connectionId', filters.connectionId)
  return params.toString()
}

/** Download link of the CSV for the same filters (the API sets the headers). */
export function whatsappCostExportUrl(
  workspaceId: string,
  filters: WhatsAppCostFilters,
): string {
  return `${base(workspaceId)}/export?${query(filters)}`
}

export function useWhatsAppCosts(
  workspaceId: string,
  filters: WhatsAppCostFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: WHATSAPP_COST_KEY(workspaceId, filters),
    queryFn: () =>
      apiFetch<WhatsAppCostReportDTO>(
        `${base(workspaceId)}?${query(filters)}`,
        undefined,
        'Erro ao buscar a análise de custos',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useWhatsAppCostSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_COST_SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppCostSettingsDTO>(
        `${base(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar o orçamento e as mensalidades',
      ),
    enabled,
  })
}

export interface UpdateWhatsAppCostSettingsInput {
  monthlyCostBudget?: number | null
  connectionFees?: { connectionId: string; monthlyFee: number | null }[]
}

export function useUpdateWhatsAppCostSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppCostSettingsInput) =>
      apiFetchJson<WhatsAppCostSettingsDTO>(
        `${base(workspaceId)}/settings`,
        'PATCH',
        data,
        'Erro ao salvar o orçamento e as mensalidades',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(WHATSAPP_COST_SETTINGS_KEY(workspaceId), data)
      // The report carries the budget and the fees.
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-costs', workspaceId],
      })
    },
  })
}

export function useWhatsAppPrices(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_COST_PRICES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppPriceDTO[]>(
        `${base(workspaceId)}/prices`,
        undefined,
        'Erro ao buscar a tabela de preços',
      ),
    enabled,
  })
}

export function useCreateWhatsAppPrice(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (
      data: Omit<CreateWhatsAppPriceDTO, 'country'> & { country?: string },
    ) =>
      apiFetchJson<WhatsAppPriceDTO>(
        `${base(workspaceId)}/prices`,
        'POST',
        data,
        'Erro ao salvar o preço',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: WHATSAPP_COST_PRICES_KEY(workspaceId),
      })
    },
  })
}

export function useDeleteWhatsAppPrice(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (priceId: string) =>
      apiFetchJson<{ id: string }>(
        `${base(workspaceId)}/prices/${priceId}`,
        'DELETE',
        undefined,
        'Erro ao excluir o preço',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: WHATSAPP_COST_PRICES_KEY(workspaceId),
      })
    },
  })
}
