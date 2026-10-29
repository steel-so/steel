import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SurveyConfigDTO,
  SurveyDTO,
  SurveyKindDTO,
  SurveyListDTO,
  SurveyReportDTO,
} from '@/types/satisfaction-survey'
import { apiFetch } from './_fetch'

const CONFIGS_KEY = (workspaceId: string) =>
  ['satisfaction-survey-configs', workspaceId] as const

export function useSurveyConfigs(workspaceId: string) {
  return useQuery({
    queryKey: CONFIGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<SurveyConfigDTO[]>(
        `/api/workspaces/${workspaceId}/surveys/config`,
        undefined,
        'Erro ao buscar as regras da pesquisa',
      ),
    staleTime: 60 * 1000,
  })
}

export type SurveyConfigInput = Partial<Omit<SurveyConfigDTO, 'trigger'>>

export function useUpdateSurveyConfig(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      trigger: SurveyConfigDTO['trigger']
      data: SurveyConfigInput
    }) =>
      apiFetch<SurveyConfigDTO>(
        `/api/workspaces/${workspaceId}/surveys/config/${input.trigger}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input.data),
        },
        'Erro ao salvar a regra da pesquisa',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIGS_KEY(workspaceId) })
    },
  })
}

export interface SurveyReportParams {
  kind: SurveyKindDTO
  groupBy: SurveyReportDTO['groupBy']
  from?: string
  to?: string
}

export function useSurveyReport(
  workspaceId: string,
  params: SurveyReportParams,
) {
  return useQuery({
    queryKey: ['satisfaction-survey-report', workspaceId, params] as const,
    queryFn: () => {
      const query = new URLSearchParams({
        kind: params.kind,
        groupBy: params.groupBy,
      })
      if (params.from) query.set('from', params.from)
      if (params.to) query.set('to', params.to)
      return apiFetch<SurveyReportDTO>(
        `/api/workspaces/${workspaceId}/surveys/report?${query}`,
        undefined,
        'Erro ao buscar o relatório da pesquisa',
      )
    },
    staleTime: 30 * 1000,
  })
}

export function useSurveyList(
  workspaceId: string,
  params: { kind?: SurveyKindDTO; status?: SurveyDTO['status']; page: number },
) {
  return useQuery({
    queryKey: ['satisfaction-survey-list', workspaceId, params] as const,
    queryFn: () => {
      const query = new URLSearchParams({
        page: String(params.page),
        pageSize: '15',
      })
      if (params.kind) query.set('kind', params.kind)
      if (params.status) query.set('status', params.status)
      return apiFetch<SurveyListDTO>(
        `/api/workspaces/${workspaceId}/surveys?${query}`,
        undefined,
        'Erro ao buscar as pesquisas',
      )
    },
    staleTime: 30 * 1000,
  })
}

export function useSendSurvey(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      kind: SurveyKindDTO
      whatsappContactId?: string
      email?: string
      recipientName?: string
    }) =>
      apiFetch<SurveyDTO>(
        `/api/workspaces/${workspaceId}/surveys`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao enviar a pesquisa',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['satisfaction-survey-list', workspaceId],
      })
    },
  })
}

export function useAnswerPublicSurvey(token: string) {
  return useMutation({
    mutationFn: (data: { score: number; comment?: string }) =>
      apiFetch<{ answered: true }>(
        `/api/surveys/public/${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao enviar a resposta',
      ),
  })
}
