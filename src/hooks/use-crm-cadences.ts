'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCrmCadenceDTO,
  CrmCadenceEnrollmentActionDTO,
  EnrollCrmCadenceDTO,
  UpdateCrmCadenceDTO,
} from '@/src/schemas/crm-cadence.schema'
import type {
  CrmCadenceDTO,
  CrmCadenceEnrollmentDTO,
  CrmCadenceEnrollmentStatusDTO,
  CrmCadenceEnrollResultDTO,
} from '@/types/crm-cadence'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/** Sales cadences (c1-sales-cadences): cadences, enrollments and lead actions. */

const base = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}/crm`

export const crmCadenceKeys = {
  all: (ws: string) => ['crm-cadences', ws] as const,
  list: (ws: string) => ['crm-cadences', ws, 'list'] as const,
  enrollments: (ws: string, filters: { cadenceId?: string; leadId?: string }) =>
    ['crm-cadences', ws, 'enrollments', filters] as const,
}

export function useCrmCadences(workspaceId: string) {
  return useQuery({
    queryKey: crmCadenceKeys.list(workspaceId),
    queryFn: () =>
      apiFetch<CrmCadenceDTO[]>(
        `${base(workspaceId)}/cadences`,
        undefined,
        'Erro ao buscar as cadências',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmCadenceEnrollments(
  workspaceId: string,
  filters: {
    cadenceId?: string
    leadId?: string
    status?: CrmCadenceEnrollmentStatusDTO
  },
  options: { enabled?: boolean } = {},
) {
  const params = new URLSearchParams()
  if (filters.cadenceId) params.set('cadenceId', filters.cadenceId)
  if (filters.leadId) params.set('leadId', filters.leadId)
  if (filters.status) params.set('status', filters.status)
  const query = params.toString()
  return useQuery({
    queryKey: crmCadenceKeys.enrollments(workspaceId, filters),
    queryFn: () =>
      apiFetch<CrmCadenceEnrollmentDTO[]>(
        `${base(workspaceId)}/cadence-enrollments${query ? `?${query}` : ''}`,
        undefined,
        'Erro ao buscar as inscrições',
      ),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    // Running cadences move on their own (worker tick): keep the list fresh.
    refetchInterval: 30_000,
  })
}

export function useCreateCrmCadence(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCrmCadenceDTO) =>
      apiFetchJson<CrmCadenceDTO>(
        `${base(workspaceId)}/cadences`,
        'POST',
        input,
        'Erro ao criar a cadência',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCadenceKeys.all(workspaceId),
      }),
  })
}

export function useUpdateCrmCadence(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      cadenceId,
      ...input
    }: UpdateCrmCadenceDTO & { cadenceId: string }) =>
      apiFetchJson<CrmCadenceDTO>(
        `${base(workspaceId)}/cadences/${cadenceId}`,
        'PATCH',
        input,
        'Erro ao salvar a cadência',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCadenceKeys.all(workspaceId),
      }),
  })
}

export function useDeleteCrmCadence(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cadenceId: string) =>
      apiSend(
        `${base(workspaceId)}/cadences/${cadenceId}`,
        { method: 'DELETE' },
        'Erro ao arquivar a cadência',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCadenceKeys.all(workspaceId),
      }),
  })
}

export function useEnrollCrmCadence(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EnrollCrmCadenceDTO) =>
      apiFetchJson<CrmCadenceEnrollResultDTO>(
        `${base(workspaceId)}/cadence-enrollments`,
        'POST',
        input,
        'Erro ao inscrever na cadência',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCadenceKeys.all(workspaceId),
      }),
  })
}

export function useActCrmCadenceEnrollment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      enrollmentId,
      ...input
    }: CrmCadenceEnrollmentActionDTO & { enrollmentId: string }) =>
      apiFetchJson<CrmCadenceEnrollmentDTO>(
        `${base(workspaceId)}/cadence-enrollments/${enrollmentId}`,
        'PATCH',
        input,
        'Erro ao atualizar a inscrição',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCadenceKeys.all(workspaceId),
      }),
  })
}
