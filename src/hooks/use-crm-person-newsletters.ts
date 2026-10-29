'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmPersonNewslettersDTO,
  SubscribeCrmPersonNewsletterDTO,
} from '@/src/schemas/crm-newsletter-bridge.schema'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string, personId: string) =>
  `/api/workspaces/${workspaceId}/crm/people/${personId}/newsletters`

export const crmPersonNewsletterKeys = {
  detail: (ws: string, personId: string) =>
    ['crm-person-newsletters', ws, personId] as const,
}

/** Newsletter subscriptions of a CRM person (card on the person page). */
export function useCrmPersonNewsletters(workspaceId: string, personId: string) {
  return useQuery({
    queryKey: crmPersonNewsletterKeys.detail(workspaceId, personId),
    queryFn: () =>
      apiFetch<CrmPersonNewslettersDTO>(
        base(workspaceId, personId),
        undefined,
        'Erro ao buscar as newsletters da pessoa',
      ),
    retry: false,
  })
}

function useSetPersonNewsletters(workspaceId: string, personId: string) {
  const queryClient = useQueryClient()
  return (data: CrmPersonNewslettersDTO) => {
    queryClient.setQueryData(
      crmPersonNewsletterKeys.detail(workspaceId, personId),
      data,
    )
    // The newsletter subscriber lists and the timeline changed too.
    void queryClient.invalidateQueries({
      queryKey: ['crm-newsletter-subscribers', workspaceId],
    })
  }
}

export function useSubscribeCrmPerson(workspaceId: string, personId: string) {
  const set = useSetPersonNewsletters(workspaceId, personId)
  return useMutation({
    mutationFn: (dto: Partial<SubscribeCrmPersonNewsletterDTO>) =>
      apiFetchJson<CrmPersonNewslettersDTO>(
        base(workspaceId, personId),
        'POST',
        dto,
        'Erro ao inscrever a pessoa',
      ),
    onSuccess: set,
  })
}

export function useUnsubscribeCrmPerson(workspaceId: string, personId: string) {
  const set = useSetPersonNewsletters(workspaceId, personId)
  return useMutation({
    mutationFn: (subscriberId: string) =>
      apiFetch<CrmPersonNewslettersDTO>(
        `${base(workspaceId, personId)}/${subscriberId}`,
        { method: 'DELETE' },
        'Erro ao descadastrar a pessoa',
      ),
    onSuccess: set,
  })
}
