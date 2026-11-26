import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateWhatsAppAiMediaDTO } from '@/src/schemas/whatsapp-ai-media.schema'
import type { WhatsAppAiMediaDTO } from '@/types/whatsapp-ai-media'
import { apiFetch } from './_fetch'

const KEY = (workspaceId: string) => ['whatsapp-ai-media', workspaceId] as const

const url = (workspaceId: string, suffix = '') =>
  `/api/workspaces/${workspaceId}/whatsapp/ai-config/media${suffix}`

/** Images and videos the AI can send in a conversation. */
export function useWhatsAppAiMedia(workspaceId: string) {
  return useQuery({
    queryKey: KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAiMediaDTO[]>(
        url(workspaceId),
        undefined,
        'Erro ao buscar os arquivos da IA',
      ),
    staleTime: 15 * 1000,
  })
}

export function useCreateWhatsAppAiMedia(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { file: File; name: string; whenToSend: string }) => {
      const form = new FormData()
      form.set('file', input.file)
      form.set('name', input.name)
      form.set('whenToSend', input.whenToSend)
      return apiFetch<WhatsAppAiMediaDTO>(
        url(workspaceId),
        { method: 'POST', body: form },
        'Erro ao enviar o arquivo',
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: KEY(workspaceId) }),
  })
}

export function useUpdateWhatsAppAiMedia(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      mediaId,
      ...dto
    }: UpdateWhatsAppAiMediaDTO & { mediaId: string }) =>
      apiFetch<WhatsAppAiMediaDTO>(
        url(workspaceId, `/${mediaId}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dto),
        },
        'Erro ao salvar o arquivo',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: KEY(workspaceId) }),
  })
}

export function useDeleteWhatsAppAiMedia(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: string) =>
      apiFetch<{ id: string }>(
        url(workspaceId, `/${mediaId}`),
        { method: 'DELETE' },
        'Erro ao remover o arquivo',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: KEY(workspaceId) }),
  })
}
