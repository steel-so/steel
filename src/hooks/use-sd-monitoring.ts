import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSdMonitorSourceDTO,
  LinkSdMonitorAlertDTO,
  UpdateSdMonitorSourceDTO,
} from '@/src/schemas/sd-monitor-source.schema'
import type {
  SdMonitorAlertDTO,
  SdMonitorAlertStatusDTO,
  SdMonitorSourceDTO,
  SdMonitorSourceWithTokenDTO,
} from '@/types/sd-monitor'
import { apiFetch, apiSend } from './_fetch'

/**
 * Monitoramento do ServiceDesk: origens (Zabbix / webhook genérico) e os
 * alertas recebidos. As chaves ficam sob `['sd-monitoring', workspaceId]`,
 * então qualquer mutação atualiza a aba inteira.
 *
 * O token em claro **só** volta na criação e na regeração — guarde o
 * resultado da mutação para mostrá-lo uma vez; ele não está nas listagens.
 */

export interface SdMonitorAlertFilters {
  sourceId?: string
  ticketId?: string
  /** Alertas ligados a este item da CMDB. */
  configItemId?: string
  /** Só os alertas cujo host não casou com a CMDB. */
  unmatched?: boolean
  status?: SdMonitorAlertStatusDTO
  limit?: number
}

export const sdMonitoringKeys = {
  all: (workspaceId: string) => ['sd-monitoring', workspaceId] as const,
  sources: (workspaceId: string, includeInactive: boolean) =>
    ['sd-monitoring', workspaceId, 'sources', includeInactive] as const,
  alerts: (workspaceId: string, filters: SdMonitorAlertFilters) =>
    ['sd-monitoring', workspaceId, 'alerts', filters] as const,
}

function base(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/servicedesk`
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function withQuery(
  url: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: sdMonitoringKeys.all(workspaceId),
    })
}

export function useSdMonitorSources(
  workspaceId: string,
  options: { includeInactive?: boolean } = {},
) {
  const includeInactive = options.includeInactive ?? true
  return useQuery({
    queryKey: sdMonitoringKeys.sources(workspaceId, includeInactive),
    queryFn: () =>
      apiFetch<SdMonitorSourceDTO[]>(
        withQuery(`${base(workspaceId)}/monitor-sources`, {
          includeInactive: includeInactive ? 'true' : undefined,
        }),
        undefined,
        'Erro ao carregar as origens de monitoramento',
      ),
    enabled: !!workspaceId,
  })
}

export function useSdMonitorAlerts(
  workspaceId: string,
  filters: SdMonitorAlertFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: sdMonitoringKeys.alerts(workspaceId, filters),
    queryFn: () =>
      apiFetch<SdMonitorAlertDTO[]>(
        withQuery(`${base(workspaceId)}/monitor-alerts`, {
          ...filters,
          unmatched: filters.unmatched ? 'true' : undefined,
        }),
        undefined,
        'Erro ao carregar os alertas',
      ),
    enabled: !!workspaceId && (options.enabled ?? true),
  })
}

export function useSdMonitorSourceMutations(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const url = `${base(workspaceId)}/monitor-sources`

  const create = useMutation({
    mutationFn: (data: CreateSdMonitorSourceDTO) =>
      apiFetch<SdMonitorSourceWithTokenDTO>(
        url,
        json('POST', data),
        'Erro ao criar a origem',
      ),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateSdMonitorSourceDTO
    }) =>
      apiFetch<SdMonitorSourceDTO>(
        `${url}/${id}`,
        json('PATCH', data),
        'Erro ao salvar a origem',
      ),
    onSuccess: invalidate,
  })
  const regenerateToken = useMutation({
    mutationFn: (id: string) =>
      apiFetch<SdMonitorSourceWithTokenDTO>(
        `${url}/${id}/token`,
        json('POST', {}),
        'Erro ao gerar um token novo',
      ),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiSend(`${url}/${id}`, { method: 'DELETE' }, 'Erro ao excluir a origem'),
    onSuccess: invalidate,
  })
  return { create, update, regenerateToken, remove }
}

/** Liga (ou desliga) o item da CMDB de um alerta; com `remember`, guarda o host. */
export function useLinkSdMonitorAlert(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({
      alertId,
      data,
    }: {
      alertId: string
      data: LinkSdMonitorAlertDTO
    }) =>
      apiFetch<SdMonitorAlertDTO>(
        `${base(workspaceId)}/monitor-alerts/${alertId}`,
        json('PATCH', data),
        'Erro ao ligar o alerta ao item da CMDB',
      ),
    onSuccess: invalidate,
  })
}
