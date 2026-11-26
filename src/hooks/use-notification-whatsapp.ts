import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationWhatsappDTO } from '@/types/notification'
import { apiFetch } from './_fetch'

const KEY = (workspaceId: string) =>
  ['notification-whatsapp', workspaceId] as const

const url = (workspaceId: string, suffix = '') =>
  `/api/workspaces/${workspaceId}/notifications/preferences/whatsapp${suffix}`

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** State of the user's WhatsApp channel for platform notices. */
export function useNotificationWhatsapp(workspaceId: string) {
  return useQuery({
    queryKey: KEY(workspaceId),
    queryFn: () =>
      apiFetch<NotificationWhatsappDTO>(
        url(workspaceId),
        undefined,
        'Erro ao carregar o canal de WhatsApp',
      ),
    enabled: Boolean(workspaceId),
  })
}

/** Send code, confirm code, switch on/off and remove the number. */
export function useNotificationWhatsappActions(workspaceId: string) {
  const queryClient = useQueryClient()
  const onSuccess = (data: NotificationWhatsappDTO) =>
    queryClient.setQueryData(KEY(workspaceId), data)

  const sendCode = useMutation({
    mutationFn: (number: string) =>
      apiFetch<NotificationWhatsappDTO>(
        url(workspaceId, '/code'),
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ number }),
        },
        'Erro ao enviar o código',
      ),
    onSuccess,
  })
  const confirm = useMutation({
    mutationFn: (code: string) =>
      apiFetch<NotificationWhatsappDTO>(
        url(workspaceId, '/confirm'),
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ code }),
        },
        'Erro ao confirmar o código',
      ),
    onSuccess,
  })
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<NotificationWhatsappDTO>(
        url(workspaceId),
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ enabled }),
        },
        'Erro ao salvar o canal de WhatsApp',
      ),
    onSuccess,
  })
  const remove = useMutation({
    mutationFn: () =>
      apiFetch<NotificationWhatsappDTO>(
        url(workspaceId),
        { method: 'DELETE' },
        'Erro ao remover o número',
      ),
    onSuccess,
  })
  return { sendCode, confirm, setEnabled, remove }
}
