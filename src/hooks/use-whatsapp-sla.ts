import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppSlaPolicyDTO,
  UpdateWhatsAppSlaPolicyDTO,
} from '@/src/schemas/whatsapp-sla.schema'
import type {
  WhatsAppSlaOpenCycleDTO,
  WhatsAppSlaPolicyDTO,
  WhatsAppSlaReportDTO,
} from '@/types/whatsapp-sla'
import { apiFetch } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/sla`

export const WHATSAPP_SLA_POLICIES_KEY = (workspaceId: string) =>
  ['whatsapp-sla-policies', workspaceId] as const

export const WHATSAPP_SLA_OPEN_KEY = (workspaceId: string) =>
  ['whatsapp-sla-open', workspaceId] as const

/** SLA policies of the workspace (default first, then team overrides). */
export function useWhatsAppSlaPolicies(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_SLA_POLICIES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSlaPolicyDTO[]>(
        `${base(workspaceId)}/policies`,
        undefined,
        'Erro ao buscar as políticas de SLA',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

function useInvalidatePolicies(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: WHATSAPP_SLA_POLICIES_KEY(workspaceId),
    })
}

export function useCreateWhatsAppSlaPolicy(workspaceId: string) {
  const invalidate = useInvalidatePolicies(workspaceId)
  return useMutation({
    mutationFn: (data: CreateWhatsAppSlaPolicyDTO) =>
      apiFetch<WhatsAppSlaPolicyDTO>(
        `${base(workspaceId)}/policies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar a política de SLA',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateWhatsAppSlaPolicy(workspaceId: string) {
  const invalidate = useInvalidatePolicies(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: UpdateWhatsAppSlaPolicyDTO & { id: string }) =>
      apiFetch<WhatsAppSlaPolicyDTO>(
        `${base(workspaceId)}/policies/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar a política de SLA',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteWhatsAppSlaPolicy(workspaceId: string) {
  const invalidate = useInvalidatePolicies(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(
        `${base(workspaceId)}/policies/${id}`,
        { method: 'DELETE' },
        'Erro ao remover a política de SLA',
      ),
    onSuccess: invalidate,
  })
}

/**
 * Open SLA cycles the viewer can see. Polled every 30 s (the states change
 * with the clock, not with an event); the chip counts down locally between
 * polls.
 */
export function useWhatsAppSlaOpenCycles(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_SLA_OPEN_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSlaOpenCycleDTO[]>(
        `${base(workspaceId)}/open`,
        undefined,
        'Erro ao buscar o SLA das conversas',
      ),
    enabled: enabled && Boolean(workspaceId),
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  })
}

export interface WhatsAppSlaReportParams {
  from?: string
  to?: string
  teamId?: string
}

function reportQuery(params: WhatsAppSlaReportParams): string {
  const query = new URLSearchParams()
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.teamId) query.set('teamId', params.teamId)
  return query.toString()
}

/** CSV download URL of the same filters. */
export function whatsAppSlaReportCsvUrl(
  workspaceId: string,
  params: WhatsAppSlaReportParams,
): string {
  const query = reportQuery(params)
  return `${base(workspaceId)}/report?${query ? `${query}&` : ''}format=csv`
}

export function useWhatsAppSlaReport(
  workspaceId: string,
  params: WhatsAppSlaReportParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ['whatsapp-sla-report', workspaceId, params] as const,
    queryFn: () =>
      apiFetch<WhatsAppSlaReportDTO>(
        `${base(workspaceId)}/report?${reportQuery(params)}`,
        undefined,
        'Erro ao buscar o relatório de SLA',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}
