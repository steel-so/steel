import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppChatbotDTO,
  SetWhatsAppChatbotStatusDTO,
  SimulateWhatsAppChatbotDTO,
  UpdateWhatsAppChatbotDTO,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type {
  WhatsAppChatbotDTO,
  WhatsAppChatbotFlowIssueDTO,
  WhatsAppChatbotListItemDTO,
  WhatsAppChatbotPublishDTO,
  WhatsAppChatbotSessionDTO,
  WhatsAppChatbotSessionStatusDTO,
  WhatsAppChatbotSimulationDTO,
} from '@/types/whatsapp-chatbot'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

export const WHATSAPP_CHATBOTS_KEY = (workspaceId: string) =>
  ['whatsapp-chatbots', workspaceId] as const

const CHATBOT_KEY = (workspaceId: string, chatbotId: string) =>
  ['whatsapp-chatbots', workspaceId, chatbotId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/chatbots`

/** Input accepted when creating a bot (defaults are filled by the API). */
export type CreateChatbotInput = Partial<CreateWhatsAppChatbotDTO> &
  Pick<CreateWhatsAppChatbotDTO, 'name'>

export function useWhatsAppChatbots(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_CHATBOTS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppChatbotListItemDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar chatbots',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useWhatsAppChatbot(workspaceId: string, chatbotId: string) {
  return useQuery({
    queryKey: CHATBOT_KEY(workspaceId, chatbotId),
    queryFn: () =>
      apiFetch<WhatsAppChatbotDTO>(
        `${base(workspaceId)}/${chatbotId}`,
        undefined,
        'Erro ao buscar o chatbot',
      ),
    enabled: Boolean(workspaceId && chatbotId),
    staleTime: 0,
  })
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: WHATSAPP_CHATBOTS_KEY(workspaceId),
    })
}

export function useCreateWhatsAppChatbot(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: CreateChatbotInput) =>
      apiFetchJson<WhatsAppChatbotDTO>(
        base(workspaceId),
        'POST',
        data,
        'Erro ao criar o chatbot',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateWhatsAppChatbot(
  workspaceId: string,
  chatbotId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: UpdateWhatsAppChatbotDTO) =>
      apiFetchJson<WhatsAppChatbotDTO>(
        `${base(workspaceId)}/${chatbotId}`,
        'PATCH',
        data,
        'Erro ao salvar o chatbot',
      ),
    onSuccess: invalidate,
  })
}

export function usePublishWhatsAppChatbot(
  workspaceId: string,
  chatbotId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: () =>
      apiFetchJson<WhatsAppChatbotPublishDTO>(
        `${base(workspaceId)}/${chatbotId}/publish`,
        'POST',
        undefined,
        'Erro ao publicar o chatbot',
      ),
    onSuccess: invalidate,
  })
}

export function useValidateWhatsAppChatbot(
  workspaceId: string,
  chatbotId: string,
) {
  return useMutation({
    mutationFn: () =>
      apiFetchJson<WhatsAppChatbotFlowIssueDTO[]>(
        `${base(workspaceId)}/${chatbotId}/validate`,
        'POST',
        undefined,
        'Erro ao verificar o fluxo',
      ),
  })
}

/** Activate / pause / unpublish a bot by id (the list needs any id). */
export function useSetWhatsAppChatbotStatus(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: { id: string } & SetWhatsAppChatbotStatusDTO) =>
      apiFetchJson<WhatsAppChatbotDTO>(
        `${base(workspaceId)}/${input.id}/status`,
        'PUT',
        { status: input.status },
        'Erro ao alterar o status do chatbot',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteWhatsAppChatbot(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        `${base(workspaceId)}/${id}`,
        { method: 'DELETE' },
        'Erro ao excluir o chatbot',
      ),
    onSuccess: invalidate,
  })
}

export function useSimulateWhatsAppChatbot(
  workspaceId: string,
  chatbotId: string,
) {
  return useMutation({
    mutationFn: (data: SimulateWhatsAppChatbotDTO) =>
      apiFetchJson<WhatsAppChatbotSimulationDTO>(
        `${base(workspaceId)}/${chatbotId}/simulate`,
        'POST',
        data,
        'Erro ao simular o fluxo',
      ),
  })
}

export function useWhatsAppChatbotSessions(
  workspaceId: string,
  chatbotId: string,
  options: { status?: WhatsAppChatbotSessionStatusDTO; limit?: number } = {},
  enabled = true,
) {
  const params = new URLSearchParams()
  if (options.status) params.set('status', options.status)
  params.set('limit', String(options.limit ?? 30))
  return useQuery({
    queryKey: [...CHATBOT_KEY(workspaceId, chatbotId), 'sessions', options],
    queryFn: () =>
      apiFetch<WhatsAppChatbotSessionDTO[]>(
        `${base(workspaceId)}/${chatbotId}/sessions?${params.toString()}`,
        undefined,
        'Erro ao buscar as sessões',
      ),
    enabled: enabled && Boolean(workspaceId && chatbotId),
    staleTime: 15 * 1000,
  })
}
