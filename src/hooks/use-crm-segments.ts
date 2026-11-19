'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  CreateCrmSegmentDTO,
  CrmSegmentContactsPageDTO,
  CrmSegmentDefinition,
  CrmSegmentDTO,
  CrmSegmentOptionsDTO,
  CrmSegmentPreviewDTO,
  CrmSegmentTarget,
  UpdateCrmSegmentDTO,
} from '@/src/schemas/crm-segment.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/** Dynamic contact segments (CRM > Captar e qualificar > Segmentação). */

const base = (ws: string) => `/api/workspaces/${ws}/crm/segments`

export const crmSegmentKeys = {
  all: (ws: string) => ['crm-segments', ws] as const,
  list: (ws: string) => ['crm-segments', ws, 'list'] as const,
  options: (ws: string) => ['crm-segments', ws, 'options'] as const,
  preview: (
    ws: string,
    target: CrmSegmentTarget,
    definition: CrmSegmentDefinition,
  ) => ['crm-segments', ws, 'preview', target, definition] as const,
  contacts: (ws: string, segmentId: string, page: number) =>
    ['crm-segments', ws, 'contacts', segmentId, page] as const,
}

export function useCrmSegments(workspaceId: string) {
  return useQuery({
    queryKey: crmSegmentKeys.list(workspaceId),
    queryFn: () =>
      apiFetch<CrmSegmentDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar os segmentos',
      ),
  })
}

export function useCrmSegmentOptions(workspaceId: string) {
  return useQuery({
    queryKey: crmSegmentKeys.options(workspaceId),
    queryFn: () =>
      apiFetch<CrmSegmentOptionsDTO>(
        `${base(workspaceId)}/options`,
        undefined,
        'Erro ao buscar as opções do construtor',
      ),
    staleTime: 60 * 1000,
  })
}

/**
 * Live count and sample of the rules being edited. The caller passes an
 * already debounced `definition`; `enabled` is false while the rules are
 * incomplete (the server would refuse them).
 */
export function useCrmSegmentPreview(
  workspaceId: string,
  target: CrmSegmentTarget,
  definition: CrmSegmentDefinition,
  enabled: boolean,
) {
  return useQuery({
    queryKey: crmSegmentKeys.preview(workspaceId, target, definition),
    queryFn: () =>
      apiFetchJson<CrmSegmentPreviewDTO>(
        `${base(workspaceId)}/preview`,
        'POST',
        { target, definition },
        'Erro ao contar os contatos',
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  })
}

export function useCrmSegmentContacts(
  workspaceId: string,
  segmentId: string,
  page: number,
) {
  return useQuery({
    queryKey: crmSegmentKeys.contacts(workspaceId, segmentId, page),
    queryFn: () =>
      apiFetch<CrmSegmentContactsPageDTO>(
        `${base(workspaceId)}/${segmentId}/contacts?page=${page}&pageSize=25`,
        undefined,
        'Erro ao buscar os contatos do segmento',
      ),
    placeholderData: keepPreviousData,
  })
}

export function useCreateCrmSegment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCrmSegmentDTO) =>
      apiFetchJson<CrmSegmentDTO>(
        base(workspaceId),
        'POST',
        data,
        'Erro ao criar o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmSegmentKeys.all(workspaceId),
      }),
  })
}

export function useUpdateCrmSegment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCrmSegmentDTO & { id: string }) =>
      apiFetchJson<CrmSegmentDTO>(
        `${base(workspaceId)}/${id}`,
        'PATCH',
        data,
        'Erro ao salvar o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmSegmentKeys.all(workspaceId),
      }),
  })
}

export function useDuplicateCrmSegment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<CrmSegmentDTO>(
        `${base(workspaceId)}/${id}/duplicate`,
        'POST',
        undefined,
        'Erro ao duplicar o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmSegmentKeys.all(workspaceId),
      }),
  })
}

export function useDeleteCrmSegment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        `${base(workspaceId)}/${id}`,
        { method: 'DELETE' },
        'Erro ao excluir o segmento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmSegmentKeys.all(workspaceId),
      }),
  })
}
