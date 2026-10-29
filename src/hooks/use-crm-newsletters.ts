'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  AddCrmNewsletterSubscriberDTO,
  CreateCrmNewsletterDTO,
  CrmNewsletterDTO,
  CrmNewsletterImportResultDTO,
  CrmNewsletterSubscriberDTO,
  CrmNewsletterSubscriberPageDTO,
  CrmNewsletterSubscriberSourceValue,
  CrmNewsletterSubscriberStatusValue,
  ImportCrmNewsletterSubscribersDTO,
  UpdateCrmNewsletterDTO,
} from '@/src/schemas/crm-newsletter.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/newsletters`

export type CrmNewsletterSubscriberFilters = {
  page: number
  pageSize: number
  search?: string
  status?: CrmNewsletterSubscriberStatusValue
  source?: CrmNewsletterSubscriberSourceValue
}

export const crmNewsletterKeys = {
  list: (ws: string) => ['crm-newsletters', ws] as const,
  detail: (ws: string, id: string) => ['crm-newsletter', ws, id] as const,
  subscribers: (ws: string, id: string) =>
    ['crm-newsletter-subscribers', ws, id] as const,
  subscriberPage: (
    ws: string,
    id: string,
    filters: CrmNewsletterSubscriberFilters,
  ) => ['crm-newsletter-subscribers', ws, id, filters] as const,
}

/** URL of the subscribers CSV (a plain link downloads it). */
export function crmNewsletterExportUrl(
  workspaceId: string,
  newsletterId: string,
): string {
  return `${base(workspaceId)}/${newsletterId}/subscribers/export`
}

export function useCrmNewsletters(workspaceId: string) {
  return useQuery({
    queryKey: crmNewsletterKeys.list(workspaceId),
    queryFn: () =>
      apiFetch<CrmNewsletterDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar as newsletters',
      ),
  })
}

export function useCrmNewsletter(workspaceId: string, newsletterId: string) {
  return useQuery({
    queryKey: crmNewsletterKeys.detail(workspaceId, newsletterId),
    queryFn: () =>
      apiFetch<CrmNewsletterDTO>(
        `${base(workspaceId)}/${newsletterId}`,
        undefined,
        'Erro ao buscar a newsletter',
      ),
  })
}

export function useCreateCrmNewsletter(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: Partial<CreateCrmNewsletterDTO>) =>
      apiFetchJson<CrmNewsletterDTO>(
        base(workspaceId),
        'POST',
        dto,
        'Erro ao criar a newsletter',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterKeys.list(workspaceId),
      }),
  })
}

export function useUpdateCrmNewsletter(
  workspaceId: string,
  newsletterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: UpdateCrmNewsletterDTO) =>
      apiFetchJson<CrmNewsletterDTO>(
        `${base(workspaceId)}/${newsletterId}`,
        'PATCH',
        dto,
        'Erro ao salvar a newsletter',
      ),
    onSuccess: (newsletter) => {
      queryClient.setQueryData(
        crmNewsletterKeys.detail(workspaceId, newsletterId),
        newsletter,
      )
      void queryClient.invalidateQueries({
        queryKey: crmNewsletterKeys.list(workspaceId),
      })
    },
  })
}

export function useDeleteCrmNewsletter(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (newsletterId: string) =>
      apiSend(
        `${base(workspaceId)}/${newsletterId}`,
        { method: 'DELETE' },
        'Erro ao excluir a newsletter',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmNewsletterKeys.list(workspaceId),
      }),
  })
}

export function useCrmNewsletterSubscribers(
  workspaceId: string,
  newsletterId: string,
  filters: CrmNewsletterSubscriberFilters,
) {
  return useQuery({
    queryKey: crmNewsletterKeys.subscriberPage(
      workspaceId,
      newsletterId,
      filters,
    ),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.page),
        pageSize: String(filters.pageSize),
      })
      if (filters.search) params.set('search', filters.search)
      if (filters.status) params.set('status', filters.status)
      if (filters.source) params.set('source', filters.source)
      return apiFetch<CrmNewsletterSubscriberPageDTO>(
        `${base(workspaceId)}/${newsletterId}/subscribers?${params}`,
        undefined,
        'Erro ao buscar os assinantes',
      )
    },
  })
}

/** Subscribers changed: refresh the table and the counts. */
function useInvalidateSubscribers(workspaceId: string, newsletterId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: crmNewsletterKeys.subscribers(workspaceId, newsletterId),
    })
    void queryClient.invalidateQueries({
      queryKey: crmNewsletterKeys.detail(workspaceId, newsletterId),
    })
    void queryClient.invalidateQueries({
      queryKey: crmNewsletterKeys.list(workspaceId),
    })
  }
}

export function useAddCrmNewsletterSubscriber(
  workspaceId: string,
  newsletterId: string,
) {
  const invalidate = useInvalidateSubscribers(workspaceId, newsletterId)
  return useMutation({
    mutationFn: (dto: Partial<AddCrmNewsletterSubscriberDTO>) =>
      apiFetchJson<CrmNewsletterSubscriberDTO>(
        `${base(workspaceId)}/${newsletterId}/subscribers`,
        'POST',
        dto,
        'Erro ao adicionar o assinante',
      ),
    onSuccess: invalidate,
  })
}

export function useImportCrmNewsletterSubscribers(
  workspaceId: string,
  newsletterId: string,
) {
  const invalidate = useInvalidateSubscribers(workspaceId, newsletterId)
  return useMutation({
    mutationFn: (dto: ImportCrmNewsletterSubscribersDTO) =>
      apiFetchJson<CrmNewsletterImportResultDTO>(
        `${base(workspaceId)}/${newsletterId}/subscribers/import`,
        'POST',
        dto,
        'Erro ao importar os assinantes',
      ),
    onSuccess: invalidate,
  })
}

export function useRemoveCrmNewsletterSubscriber(
  workspaceId: string,
  newsletterId: string,
) {
  const invalidate = useInvalidateSubscribers(workspaceId, newsletterId)
  return useMutation({
    mutationFn: (subscriberId: string) =>
      apiSend(
        `${base(workspaceId)}/${newsletterId}/subscribers/${subscriberId}`,
        { method: 'DELETE' },
        'Erro ao remover o assinante',
      ),
    onSuccess: invalidate,
  })
}

export function useResendCrmNewsletterConfirmation(
  workspaceId: string,
  newsletterId: string,
) {
  return useMutation({
    mutationFn: (subscriberId: string) =>
      apiFetchJson<{ sent: boolean }>(
        `${base(workspaceId)}/${newsletterId}/subscribers/${subscriberId}/resend-confirmation`,
        'POST',
        undefined,
        'Erro ao reenviar a confirmação',
      ),
  })
}
