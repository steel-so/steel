import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppAutoOutreachDTO } from '@/types/whatsapp-auto-outreach'
import { apiFetch } from './_fetch'

const AUTO_OUTREACH_KEY = (workspaceId: string) =>
  ['whatsapp-auto-outreach', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/auto-outreach`

/** Polls every 5 s while the run is on, so the counters move. */
export function useWhatsAppAutoOutreach(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: AUTO_OUTREACH_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAutoOutreachDTO>(
        base(workspaceId),
        undefined,
        'Erro ao buscar o disparo automático',
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' ? 5000 : false,
  })
}

function useOutreachMutation<TInput>(
  workspaceId: string,
  request: (input: TInput) => { path: string; init: RequestInit },
  fallback: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TInput) => {
      const { path, init } = request(input)
      return apiFetch<WhatsAppAutoOutreachDTO & { added?: number }>(
        `${base(workspaceId)}${path}`,
        init,
        fallback,
      )
    },
    onSuccess: (data) => {
      queryClient.setQueryData(AUTO_OUTREACH_KEY(workspaceId), data)
    },
  })
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function useConfigureWhatsAppAutoOutreach(workspaceId: string) {
  return useOutreachMutation(
    workspaceId,
    (input: {
      connectionId?: string
      templateId?: string
      intervalSeconds?: number
    }) => ({
      path: '',
      init: { ...json(input), method: 'PATCH' },
    }),
    'Erro ao salvar o disparo automático',
  )
}

export function useQueueWhatsAppAutoOutreach(workspaceId: string) {
  return useOutreachMutation(
    workspaceId,
    (input: { all?: boolean; contactIds?: string[] }) => ({
      path: '/recipients',
      init: json(input),
    }),
    'Erro ao adicionar contatos à fila',
  )
}

export function useClearWhatsAppAutoOutreach(workspaceId: string) {
  return useOutreachMutation(
    workspaceId,
    (input: { all?: boolean }) => ({
      path: `/recipients${input.all ? '?all=true' : ''}`,
      init: { method: 'DELETE' },
    }),
    'Erro ao limpar a fila',
  )
}

export function usePlayWhatsAppAutoOutreach(workspaceId: string) {
  return useOutreachMutation(
    workspaceId,
    (_input: void) => ({ path: '/play', init: { method: 'POST' } }),
    'Erro ao iniciar o disparo',
  )
}

export function usePauseWhatsAppAutoOutreach(workspaceId: string) {
  return useOutreachMutation(
    workspaceId,
    (_input: void) => ({ path: '/pause', init: { method: 'POST' } }),
    'Erro ao pausar o disparo',
  )
}
