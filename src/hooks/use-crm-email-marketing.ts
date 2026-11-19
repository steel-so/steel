import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type {
  CrmCampaignRecipientScopeDTO,
  CrmEmailCampaignDTO,
  CrmEmailCampaignRecipientDTO,
  CrmEmailOptOutDTO,
  CrmMailingListDTO,
  CrmMailingListMemberDTO,
} from '@/types/crm-email-marketing'
import { apiFetch, apiSend } from './_fetch'

function mailingListsKey(workspaceId: string) {
  return ['crm-mailing-lists', workspaceId] as const
}

function mailingListMembersKey(workspaceId: string, listId: string) {
  return ['crm-mailing-list-members', workspaceId, listId] as const
}

function emailCampaignsKey(workspaceId: string) {
  return ['crm-email-campaigns', workspaceId] as const
}

function emailCampaignRecipientsKey(workspaceId: string, campaignId: string) {
  return ['crm-email-campaign-recipients', workspaceId, campaignId] as const
}

function emailOptOutsKey(workspaceId: string) {
  return ['crm-email-opt-outs', workspaceId] as const
}

/** Descadastros LGPD do workspace — só para exibir quem será excluído; a
 * exclusão real acontece no servidor ao montar/enviar a campanha. */
export function useCrmEmailOptOuts(workspaceId: string) {
  const query = useQuery({
    queryKey: emailOptOutsKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmEmailOptOutDTO[]>(
        `/api/workspaces/${workspaceId}/crm/email-opt-outs`,
        undefined,
        'Erro ao buscar descadastros',
      ),
    staleTime: 30 * 1000,
  })
  const { emails, personIds } = useMemo(() => {
    const optOuts = query.data ?? []
    return {
      emails: new Set(optOuts.map((o) => o.email.toLowerCase())),
      personIds: new Set(
        optOuts.flatMap((o) => (o.personId ? [o.personId] : [])),
      ),
    }
  }, [query.data])
  const isOptedOut = useCallback(
    (email: string | undefined, personId?: string | null) =>
      (email ? emails.has(email.trim().toLowerCase()) : false) ||
      (personId ? personIds.has(personId) : false),
    [emails, personIds],
  )
  return { ...query, isOptedOut }
}

export function useCreateCrmMailingList(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiFetch<CrmMailingListDTO>(
        `/api/workspaces/${workspaceId}/crm/mailing-lists`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar lista de e-mail',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mailingListsKey(workspaceId) })
    },
  })
}

export function useDeleteCrmMailingList(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (listId: string) =>
      apiSend(
        `/api/workspaces/${workspaceId}/crm/mailing-lists/${listId}`,
        { method: 'DELETE' },
        'Erro ao remover lista de e-mail',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mailingListsKey(workspaceId) })
    },
  })
}

export function useAddCrmMailingListMember(
  workspaceId: string,
  listId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { email: string; name?: string }) =>
      apiFetch<CrmMailingListMemberDTO>(
        `/api/workspaces/${workspaceId}/crm/mailing-lists/${listId}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao adicionar contato à lista',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: mailingListMembersKey(workspaceId, listId),
      })
    },
  })
}

export function useRemoveCrmMailingListMember(
  workspaceId: string,
  listId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (memberId: string) =>
      apiSend(
        `/api/workspaces/${workspaceId}/crm/mailing-lists/${listId}/members/${memberId}`,
        { method: 'DELETE' },
        'Erro ao remover contato da lista',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: mailingListMembersKey(workspaceId, listId),
      })
    },
  })
}

export function useCreateCrmEmailCampaign(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      subject: string
      /** Free HTML — or `templateId` of a visual-builder template. */
      contentHtml?: string
      contentJson?: string
      templateId?: string
      campaignLink?: string
      fromAddress: string
      recipientScope: CrmCampaignRecipientScopeDTO
      mailingListIds?: string[]
      segmentIds?: string[]
      personIds?: string[]
      extraEmails?: string[]
      scheduledAt?: string
    }) =>
      apiFetch<CrmEmailCampaignDTO>(
        `/api/workspaces/${workspaceId}/crm/email-campaigns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar campanha de e-mail',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: emailCampaignsKey(workspaceId),
      })
    },
  })
}

export function useSendCrmEmailCampaign(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (campaignId: string) =>
      apiFetch<CrmEmailCampaignDTO>(
        `/api/workspaces/${workspaceId}/crm/email-campaigns/${campaignId}/send`,
        { method: 'POST' },
        'Erro ao enviar campanha de e-mail',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: emailCampaignsKey(workspaceId),
      })
    },
  })
}

export function useCrmEmailCampaignRecipients(
  workspaceId: string,
  campaignId: string | null,
) {
  return useQuery({
    queryKey: emailCampaignRecipientsKey(workspaceId, campaignId ?? ''),
    queryFn: () =>
      apiFetch<CrmEmailCampaignRecipientDTO[]>(
        `/api/workspaces/${workspaceId}/crm/email-campaigns/${campaignId}/recipients`,
        undefined,
        'Erro ao buscar destinatários da campanha',
      ),
    enabled: !!workspaceId && !!campaignId,
    staleTime: 15 * 1000,
  })
}
