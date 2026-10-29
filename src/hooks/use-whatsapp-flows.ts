import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppFlowDTO,
  CreateWhatsAppFlowTemplateDTO,
  SendWhatsAppFlowDTO,
  UpdateWhatsAppFlowDTO,
} from '@/src/schemas/whatsapp-flow.schema'
import type {
  WhatsAppFlowDTO,
  WhatsAppFlowListItemDTO,
  WhatsAppFlowMetaJsonDTO,
  WhatsAppFlowPreviewDTO,
  WhatsAppFlowPublishDTO,
  WhatsAppFlowResponsesPageDTO,
  WhatsAppFlowSendDTO,
} from '@/types/whatsapp-flow'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

export const WHATSAPP_FLOWS_KEY = (workspaceId: string) =>
  ['whatsapp-flows', workspaceId] as const

const FLOW_KEY = (workspaceId: string, flowId: string) =>
  ['whatsapp-flows', workspaceId, flowId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/flows`

/** Input accepted when creating a flow (defaults are filled by the API). */
export type CreateFlowInput = Partial<CreateWhatsAppFlowDTO> &
  Pick<CreateWhatsAppFlowDTO, 'name' | 'connectionId'>

export function useWhatsAppFlows(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_FLOWS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppFlowListItemDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar os formulários',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useWhatsAppFlow(workspaceId: string, flowId: string) {
  return useQuery({
    queryKey: FLOW_KEY(workspaceId, flowId),
    queryFn: () =>
      apiFetch<WhatsAppFlowDTO>(
        `${base(workspaceId)}/${flowId}`,
        undefined,
        'Erro ao buscar o formulário',
      ),
    enabled: Boolean(workspaceId && flowId),
    staleTime: 0,
  })
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: WHATSAPP_FLOWS_KEY(workspaceId) })
}

export function useCreateWhatsAppFlow(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: CreateFlowInput) =>
      apiFetchJson<WhatsAppFlowDTO>(
        base(workspaceId),
        'POST',
        data,
        'Erro ao criar o formulário',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateWhatsAppFlow(workspaceId: string, flowId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: UpdateWhatsAppFlowDTO) =>
      apiFetchJson<WhatsAppFlowDTO>(
        `${base(workspaceId)}/${flowId}`,
        'PATCH',
        data,
        'Erro ao salvar o formulário',
      ),
    onSuccess: invalidate,
  })
}

export function usePublishWhatsAppFlow(workspaceId: string, flowId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (publish: boolean) =>
      apiFetchJson<WhatsAppFlowPublishDTO>(
        `${base(workspaceId)}/${flowId}/publish`,
        'POST',
        { publish },
        'Erro ao enviar o formulário para a Meta',
      ),
    onSettled: invalidate,
  })
}

export function useDeprecateWhatsAppFlow(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (flowId: string) =>
      apiFetchJson<WhatsAppFlowDTO>(
        `${base(workspaceId)}/${flowId}/deprecate`,
        'POST',
        undefined,
        'Erro ao descontinuar o formulário',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteWhatsAppFlow(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (flowId: string) =>
      apiSend(
        `${base(workspaceId)}/${flowId}`,
        { method: 'DELETE' },
        'Erro ao excluir o formulário',
      ),
    onSuccess: invalidate,
  })
}

export function useWhatsAppFlowMetaJson(
  workspaceId: string,
  flowId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...FLOW_KEY(workspaceId, flowId), 'meta-json'],
    queryFn: () =>
      apiFetch<WhatsAppFlowMetaJsonDTO>(
        `${base(workspaceId)}/${flowId}/meta-json`,
        undefined,
        'Erro ao gerar o JSON do formulário',
      ),
    enabled: enabled && Boolean(workspaceId && flowId),
    staleTime: 0,
  })
}

export function useWhatsAppFlowPreview(workspaceId: string, flowId: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsAppFlowPreviewDTO>(
        `${base(workspaceId)}/${flowId}/preview`,
        undefined,
        'Erro ao abrir a pré-visualização',
      ),
  })
}

export function useCreateWhatsAppFlowTemplate(
  workspaceId: string,
  flowId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (
      data: Partial<CreateWhatsAppFlowTemplateDTO> &
        Pick<CreateWhatsAppFlowTemplateDTO, 'name' | 'body'>,
    ) =>
      apiFetchJson<WhatsAppTemplateDTO>(
        `${base(workspaceId)}/${flowId}/template`,
        'POST',
        data,
        'Erro ao criar o template',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] }),
  })
}

export function useSendWhatsAppFlow(workspaceId: string, flowId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: SendWhatsAppFlowDTO) =>
      apiFetchJson<WhatsAppFlowSendDTO>(
        `${base(workspaceId)}/${flowId}/send`,
        'POST',
        data,
        'Erro ao enviar o formulário',
      ),
    onSuccess: invalidate,
  })
}

export function useWhatsAppFlowResponses(
  workspaceId: string,
  flowId: string,
  cursor?: string,
) {
  const params = new URLSearchParams({ limit: '30' })
  if (cursor) params.set('cursor', cursor)
  return useQuery({
    queryKey: [...FLOW_KEY(workspaceId, flowId), 'responses', cursor ?? null],
    queryFn: () =>
      apiFetch<WhatsAppFlowResponsesPageDTO>(
        `${base(workspaceId)}/${flowId}/responses?${params.toString()}`,
        undefined,
        'Erro ao buscar as respostas',
      ),
    enabled: Boolean(workspaceId && flowId),
    staleTime: 15 * 1000,
  })
}

/** CRM forms a flow can be copied from (only fetched when asked for). */
export function useCrmFormsForFlow(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp-flows', workspaceId, 'crm-forms'],
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string }>>(
        `/api/workspaces/${workspaceId}/crm/forms`,
        undefined,
        'Erro ao buscar os formulários do CRM',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}
