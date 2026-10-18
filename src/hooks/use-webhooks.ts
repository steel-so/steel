import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  CreateWebhookEndpointDTO,
  UpdateWebhookEndpointDTO,
} from '@/src/schemas/webhook.schema'
import type {
  WebhookDeliveryDTO,
  WebhookDeliveryStatusDTO,
  WebhookEndpointDTO,
  WebhookEndpointWithSecretDTO,
  WebhookPageDTO,
  WebhookSecretDTO,
} from '@/types/webhook'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Ajustes › Webhooks (OWNER/ADMIN, ADR 0036). Everything under
 * `['webhooks', workspaceId]`. The secret only comes back from create,
 * rotate and the explicit reveal — never from the list.
 */

export const webhookKeys = {
  all: (workspaceId: string) => ['webhooks', workspaceId] as const,
  endpoints: (workspaceId: string) =>
    ['webhooks', workspaceId, 'endpoints'] as const,
  deliveries: (
    workspaceId: string,
    filters: { endpointId?: string; status?: WebhookDeliveryStatusDTO },
  ) => ['webhooks', workspaceId, 'deliveries', filters] as const,
}

const base = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/webhooks`

const endpointPath = (workspaceId: string, endpointId: string) =>
  `${base(workspaceId)}/endpoints/${encodeURIComponent(endpointId)}`

export function useWebhookEndpoints(workspaceId: string) {
  return useQuery({
    queryKey: webhookKeys.endpoints(workspaceId),
    queryFn: () =>
      apiFetch<WebhookPageDTO<WebhookEndpointDTO>>(
        `${base(workspaceId)}/endpoints`,
        undefined,
        'Erro ao carregar os webhooks',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function webhookDeliveriesPath(
  workspaceId: string,
  filters: {
    endpointId?: string
    status?: WebhookDeliveryStatusDTO
    cursor?: string
  },
): string {
  const params = new URLSearchParams({ limit: '25' })
  if (filters.endpointId) params.set('endpointId', filters.endpointId)
  if (filters.status) params.set('status', filters.status)
  if (filters.cursor) params.set('cursor', filters.cursor)
  return `${base(workspaceId)}/deliveries?${params.toString()}`
}

export function useWebhookDeliveries(
  workspaceId: string,
  filters: { endpointId?: string; status?: WebhookDeliveryStatusDTO },
) {
  return useInfiniteQuery({
    queryKey: webhookKeys.deliveries(workspaceId, filters),
    queryFn: ({ pageParam }) =>
      apiFetch<WebhookPageDTO<WebhookDeliveryDTO>>(
        webhookDeliveriesPath(workspaceId, {
          ...filters,
          cursor: pageParam ?? undefined,
        }),
        undefined,
        'Erro ao carregar as entregas',
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(workspaceId),
  })
}

export function useWebhookMutations(workspaceId: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: webhookKeys.all(workspaceId) })

  const create = useMutation({
    mutationFn: (dto: CreateWebhookEndpointDTO) =>
      apiFetchJson<WebhookEndpointWithSecretDTO>(
        `${base(workspaceId)}/endpoints`,
        'POST',
        dto,
        'Erro ao cadastrar o webhook',
      ),
    onSuccess: refresh,
  })

  const update = useMutation({
    mutationFn: (input: { id: string; dto: UpdateWebhookEndpointDTO }) =>
      apiFetchJson<WebhookEndpointDTO>(
        endpointPath(workspaceId, input.id),
        'PATCH',
        input.dto,
        'Erro ao salvar o webhook',
      ),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<{ id: string }>(
        endpointPath(workspaceId, id),
        'DELETE',
        undefined,
        'Erro ao remover o webhook',
      ),
    onSuccess: refresh,
  })

  const reveal = useMutation({
    mutationFn: (id: string) =>
      apiFetch<WebhookSecretDTO>(
        `${endpointPath(workspaceId, id)}/secret`,
        undefined,
        'Erro ao revelar o segredo',
      ),
  })

  const rotate = useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<WebhookEndpointWithSecretDTO>(
        `${endpointPath(workspaceId, id)}/secret`,
        'POST',
        {},
        'Erro ao trocar o segredo',
      ),
    onSuccess: refresh,
  })

  const test = useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<WebhookDeliveryDTO>(
        `${endpointPath(workspaceId, id)}/test`,
        'POST',
        {},
        'Erro ao enviar o teste',
      ),
    onSuccess: refresh,
  })

  const retry = useMutation({
    mutationFn: (deliveryId: string) =>
      apiFetchJson<WebhookDeliveryDTO>(
        `${base(workspaceId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
        'POST',
        {},
        'Erro ao reenviar a entrega',
      ),
    onSuccess: refresh,
  })

  return { create, update, remove, reveal, rotate, test, retry }
}
