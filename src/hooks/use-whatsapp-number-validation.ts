import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppNumberValidationDTO } from '@/types/whatsapp-number-validation'
import { apiFetch } from './_fetch'

export interface StartNumberValidationInput {
  scope: 'CONTACTS' | 'BROADCAST' | 'AI_CAMPAIGN'
  contactIds?: string[]
  all?: boolean
  broadcastId?: string
  campaignId?: string
  connectionId?: string
  force?: boolean
}

const VALIDATION_KEY = (workspaceId: string, id: string | undefined) =>
  ['whatsapp-number-validation', workspaceId, id] as const

const isActive = (status: WhatsAppNumberValidationDTO['status'] | undefined) =>
  status === 'QUEUED' || status === 'RUNNING'

/** Starts a "tem zap?" check (small sets finish within the same call). */
export function useStartWhatsAppNumberValidation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: StartNumberValidationInput) =>
      apiFetch<WhatsAppNumberValidationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/number-validations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao validar os números',
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(VALIDATION_KEY(workspaceId, run.id), run)
    },
  })
}

/** Progress of a check, polled every 2 s while it is queued or running. */
export function useWhatsAppNumberValidation(
  workspaceId: string,
  validationId: string | undefined,
) {
  return useQuery({
    queryKey: VALIDATION_KEY(workspaceId, validationId),
    queryFn: () =>
      apiFetch<WhatsAppNumberValidationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/number-validations/${validationId}`,
        undefined,
        'Erro ao buscar o andamento da validação',
      ),
    enabled: Boolean(validationId),
    refetchInterval: (query) =>
      isActive(query.state.data?.status) ? 2000 : false,
  })
}

/** Refreshes everything a finished check changes: contacts, lists, campaigns. */
export function useRefreshAfterNumberValidation(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => {
    for (const key of [
      'whatsapp-contacts',
      'whatsapp-broadcasts',
      'whatsapp-broadcast',
      'whatsapp-ai-campaigns',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key, workspaceId] })
    }
  }
}
