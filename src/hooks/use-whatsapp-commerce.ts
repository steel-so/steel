import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppStoreDTO,
  SendCatalogProductsDTO,
  UpdateWhatsAppCommerceSettingsDTO,
  UpdateWhatsAppStoreDTO,
  UpsertEcomTriggerDTO,
} from '@/src/schemas/whatsapp-commerce.schema'
import type {
  WhatsAppCatalogOrderDTO,
  WhatsAppCatalogProductDTO,
  WhatsAppCatalogSyncResultDTO,
  WhatsAppCommerceSettingsDTO,
  WhatsAppEcomEventDTO,
  WhatsAppEcomTriggerDTO,
  WhatsAppEcomTriggerKindDTO,
  WhatsAppStoreIntegrationDTO,
  WhatsAppStoreIntegrationSecretDTO,
} from '@/types/whatsapp-commerce'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/whatsapp`

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-commerce-settings', workspaceId] as const
const PRODUCTS_KEY = (workspaceId: string) =>
  ['whatsapp-catalog-products', workspaceId] as const
const ORDERS_KEY = (workspaceId: string) =>
  ['whatsapp-catalog-orders', workspaceId] as const
const STORES_KEY = (workspaceId: string) =>
  ['whatsapp-stores', workspaceId] as const
const TRIGGERS_KEY = (workspaceId: string) =>
  ['whatsapp-ecom-triggers', workspaceId] as const
const EVENTS_KEY = (workspaceId: string) =>
  ['whatsapp-ecom-events', workspaceId] as const

export function useWhatsAppCommerceSettings(
  workspaceId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppCommerceSettingsDTO>(
        `${base(workspaceId)}/commerce/settings`,
        undefined,
        'Erro ao buscar as configurações do comércio',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppCommerceSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppCommerceSettingsDTO) =>
      apiFetchJson<WhatsAppCommerceSettingsDTO>(
        `${base(workspaceId)}/commerce/settings`,
        'PATCH',
        data,
        'Erro ao salvar as configurações do comércio',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useWhatsAppCatalogProducts(
  workspaceId: string,
  options: { onlyAvailable?: boolean; enabled?: boolean } = {},
) {
  const { onlyAvailable = false, enabled = true } = options
  return useQuery({
    queryKey: [...PRODUCTS_KEY(workspaceId), onlyAvailable] as const,
    queryFn: () =>
      apiFetch<WhatsAppCatalogProductDTO[]>(
        `${base(workspaceId)}/catalog/products${onlyAvailable ? '?available=true' : ''}`,
        undefined,
        'Erro ao buscar os produtos do catálogo',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useSetCatalogProductAvailable(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { productId: string; available: boolean }) =>
      apiFetchJson<WhatsAppCatalogProductDTO>(
        `${base(workspaceId)}/catalog/products/${input.productId}`,
        'PATCH',
        { available: input.available },
        'Erro ao atualizar o produto',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY(workspaceId) }),
  })
}

export function useSyncWhatsAppCatalog(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<WhatsAppCatalogSyncResultDTO>(
        `${base(workspaceId)}/catalog/sync`,
        'POST',
        undefined,
        'Erro ao sincronizar o catálogo',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY(workspaceId) })
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY(workspaceId) })
    },
  })
}

export function useSendCatalogProducts(workspaceId: string) {
  return useMutation({
    mutationFn: (data: SendCatalogProductsDTO) =>
      apiFetchJson<{ providerMessageId: string }>(
        `${base(workspaceId)}/catalog/send`,
        'POST',
        data,
        'Erro ao enviar os produtos',
      ),
  })
}

export function useWhatsAppCatalogOrders(workspaceId: string) {
  return useQuery({
    queryKey: ORDERS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppCatalogOrderDTO[]>(
        `${base(workspaceId)}/catalog/orders`,
        undefined,
        'Erro ao buscar os pedidos do catálogo',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

// ─── stores (Z9) ────────────────────────────────────────────────────────────

export function useWhatsAppStores(workspaceId: string) {
  return useQuery({
    queryKey: STORES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppStoreIntegrationDTO[]>(
        `${base(workspaceId)}/stores`,
        undefined,
        'Erro ao buscar as lojas',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useCreateWhatsAppStore(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWhatsAppStoreDTO) =>
      apiFetchJson<WhatsAppStoreIntegrationSecretDTO>(
        `${base(workspaceId)}/stores`,
        'POST',
        data,
        'Erro ao conectar a loja',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: STORES_KEY(workspaceId) }),
  })
}

export function useUpdateWhatsAppStore(workspaceId: string, storeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppStoreDTO) =>
      apiFetchJson<WhatsAppStoreIntegrationDTO>(
        `${base(workspaceId)}/stores/${storeId}`,
        'PATCH',
        data,
        'Erro ao atualizar a loja',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: STORES_KEY(workspaceId) }),
  })
}

export function useRotateWhatsAppStoreSecret(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (storeId: string) =>
      apiFetchJson<WhatsAppStoreIntegrationSecretDTO>(
        `${base(workspaceId)}/stores/${storeId}/rotate-secret`,
        'POST',
        undefined,
        'Erro ao gerar um novo segredo',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: STORES_KEY(workspaceId) }),
  })
}

export function useDeleteWhatsAppStore(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (storeId: string) =>
      apiFetchJson<null>(
        `${base(workspaceId)}/stores/${storeId}`,
        'DELETE',
        undefined,
        'Erro ao remover a loja',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: STORES_KEY(workspaceId) }),
  })
}

export function useWhatsAppEcomTriggers(workspaceId: string) {
  return useQuery({
    queryKey: TRIGGERS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppEcomTriggerDTO[]>(
        `${base(workspaceId)}/ecommerce/triggers`,
        undefined,
        'Erro ao buscar os gatilhos',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useUpsertWhatsAppEcomTrigger(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      kind: WhatsAppEcomTriggerKindDTO
      data: UpsertEcomTriggerDTO
    }) =>
      apiFetchJson<WhatsAppEcomTriggerDTO>(
        `${base(workspaceId)}/ecommerce/triggers/${input.kind}`,
        'PUT',
        input.data,
        'Erro ao salvar o gatilho',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: TRIGGERS_KEY(workspaceId) }),
  })
}

export function useWhatsAppEcomEvents(workspaceId: string) {
  return useQuery({
    queryKey: EVENTS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppEcomEventDTO[]>(
        `${base(workspaceId)}/ecommerce/events`,
        undefined,
        'Erro ao buscar o histórico de eventos',
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 30 * 1000,
  })
}
