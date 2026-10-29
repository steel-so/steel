'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import type {
  AddSdStatusSubscriberInput,
  CreateSdStatusPageSchema,
  UpdateSdStatusPageInput,
} from '@/src/schemas/sd-status-page.schema'
import type {
  SdPublicStatusPageDTO,
  SdStatusPageDTO,
  SdStatusPageListDTO,
  SdStatusSubscriberDTO,
  SdStatusSubscriberListDTO,
  SdStatusSubscriptionDTO,
} from '@/types/sd-status-page'
import { apiFetch, apiSend } from './_fetch'
import { sdBase, sdJson } from './_sd-directory'
import { sdMajorIncidentKeys } from './use-sd-major-incidents'

/**
 * Páginas de status do ServiceDesk (S2): administração (sessão) e a página
 * pública (sem sessão). Chave `['sd-status-pages', workspaceId]`.
 */

export const sdStatusPageKeys = {
  all: (workspaceId: string) => ['sd-status-pages', workspaceId] as const,
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: sdStatusPageKeys.all(workspaceId),
    })
    queryClient.invalidateQueries({
      queryKey: sdMajorIncidentKeys.all(workspaceId),
    })
  }
}

export function useSdStatusPages(workspaceId: string) {
  return useQuery({
    queryKey: [...sdStatusPageKeys.all(workspaceId), 'list'],
    queryFn: () =>
      apiFetch<SdStatusPageListDTO>(
        sdBase(workspaceId, 'status-pages'),
        undefined,
        'Erro ao carregar as páginas de status',
      ),
    enabled: !!workspaceId,
  })
}

export function useCreateSdStatusPage(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: z.input<typeof CreateSdStatusPageSchema>) =>
      apiFetch<SdStatusPageDTO>(
        sdBase(workspaceId, 'status-pages'),
        sdJson('POST', input),
        'Erro ao criar a página de status',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdStatusPage(workspaceId: string, pageId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: UpdateSdStatusPageInput) =>
      apiFetch<SdStatusPageDTO>(
        sdBase(workspaceId, `status-pages/${pageId}`),
        sdJson('PATCH', input),
        'Erro ao salvar a página de status',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteSdStatusPage(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (pageId: string) =>
      apiSend(
        sdBase(workspaceId, `status-pages/${pageId}`),
        { method: 'DELETE' },
        'Erro ao excluir a página de status',
      ),
    onSuccess: invalidate,
  })
}

export function useSdStatusSubscribers(
  workspaceId: string,
  pageId: string | null,
) {
  return useQuery({
    queryKey: [...sdStatusPageKeys.all(workspaceId), 'subscribers', pageId],
    queryFn: () =>
      apiFetch<SdStatusSubscriberListDTO>(
        sdBase(workspaceId, `status-pages/${pageId}/subscribers`),
        undefined,
        'Erro ao carregar os assinantes',
      ),
    enabled: !!workspaceId && !!pageId,
  })
}

export function useAddSdStatusSubscriber(workspaceId: string, pageId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: AddSdStatusSubscriberInput) =>
      apiFetch<SdStatusSubscriberDTO>(
        sdBase(workspaceId, `status-pages/${pageId}/subscribers`),
        sdJson('POST', input),
        'Erro ao adicionar o assinante',
      ),
    onSuccess: invalidate,
  })
}

export function useRemoveSdStatusSubscriber(
  workspaceId: string,
  pageId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (subscriberId: string) =>
      apiSend(
        sdBase(
          workspaceId,
          `status-pages/${pageId}/subscribers/${subscriberId}`,
        ),
        { method: 'DELETE' },
        'Erro ao remover o assinante',
      ),
    onSuccess: invalidate,
  })
}

// ----- Public page (no session) --------------------------------------------

export function usePublicSdStatusPage(
  slug: string,
  initialData?: SdPublicStatusPageDTO,
) {
  return useQuery({
    queryKey: ['sd-status-public', slug],
    queryFn: () =>
      apiFetch<SdPublicStatusPageDTO>(
        `/api/status-page/${slug}`,
        undefined,
        'Erro ao carregar a página de status',
      ),
    initialData,
    refetchInterval: 60_000,
  })
}

export function useSubscribeSdStatusPage(slug: string) {
  return useMutation({
    mutationFn: (input: { email: string; name?: string }) =>
      apiFetch<{ pendingConfirmation: true }>(
        `/api/status-page/${slug}/subscribe`,
        sdJson('POST', input),
        'Erro ao fazer a inscrição',
      ),
  })
}

export function useSdStatusSubscription(slug: string, token: string) {
  return useQuery({
    queryKey: ['sd-status-subscription', slug, token],
    queryFn: () =>
      apiFetch<SdStatusSubscriptionDTO>(
        `/api/status-page/${slug}/subscriptions/${token}`,
        undefined,
        'Inscrição não encontrada',
      ),
    retry: false,
  })
}

export function useActOnSdStatusSubscription(slug: string, token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: 'CONFIRM' | 'UNSUBSCRIBE') =>
      apiFetch<SdStatusSubscriptionDTO>(
        `/api/status-page/${slug}/subscriptions/${token}`,
        sdJson('POST', { action }),
        'Erro ao atualizar a inscrição',
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(['sd-status-subscription', slug, token], data),
  })
}
