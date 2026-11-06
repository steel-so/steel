import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateWhatsAppAgentReportSettingsDTO } from '@/src/schemas/whatsapp-agent-report.schema'
import type {
  WhatsAppAgentReportDTO,
  WhatsAppAgentReportSettingsDTO,
} from '@/types/whatsapp-agent-report'
import { apiFetch, apiFetchJson } from './_fetch'

/** Agent performance report (ADR 0062): workspace view and admin toggle. */

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/reports/agents`

export const adminWhatsappAgentReportKey = (workspaceId: string) =>
  ['admin', 'whatsapp-agent-report', workspaceId] as const

export interface WhatsAppAgentReportParams {
  from?: string
  to?: string
  teamId?: string
  connectionId?: string
}

function reportQuery(params: WhatsAppAgentReportParams): string {
  const query = new URLSearchParams()
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.teamId) query.set('teamId', params.teamId)
  if (params.connectionId) query.set('connectionId', params.connectionId)
  return query.toString()
}

/** CSV download URL of the same filters. */
export function whatsAppAgentReportCsvUrl(
  workspaceId: string,
  params: WhatsAppAgentReportParams,
): string {
  const query = reportQuery(params)
  return `${base(workspaceId)}?${query ? `${query}&` : ''}format=csv`
}

export function useWhatsAppAgentReport(
  workspaceId: string,
  params: WhatsAppAgentReportParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ['whatsapp-agent-report', workspaceId, params] as const,
    queryFn: () =>
      apiFetch<WhatsAppAgentReportDTO>(
        `${base(workspaceId)}?${reportQuery(params)}`,
        undefined,
        'Erro ao buscar o relatório de atendentes',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useAdminWhatsAppAgentReport(workspaceId: string) {
  return useQuery({
    queryKey: adminWhatsappAgentReportKey(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAgentReportSettingsDTO>(
        `/api/admin/workspaces/${workspaceId}/whatsapp-agent-report`,
        undefined,
        'Erro ao carregar o relatório de atendentes',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useUpdateAdminWhatsAppAgentReport(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWhatsAppAgentReportSettingsDTO) =>
      apiFetchJson<WhatsAppAgentReportSettingsDTO>(
        `/api/admin/workspaces/${workspaceId}/whatsapp-agent-report`,
        'PATCH',
        input,
        'Não foi possível salvar o relatório de atendentes',
      ),
    onSettled: () =>
      qc.invalidateQueries({
        queryKey: adminWhatsappAgentReportKey(workspaceId),
      }),
  })
}
