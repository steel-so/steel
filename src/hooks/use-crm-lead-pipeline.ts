import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CrmDocumentSummaryDTO } from '@/types/crm-document-summary'
import type {
  CrmLeadContactAttemptDTO,
  CrmLeadContactChannelDTO,
  CrmLeadContactOutcomeDTO,
  CrmLeadDTO,
  CrmLeadInterestLevelDTO,
  CrmLeadMeetingDTO,
  CrmLeadMeetingFormatDTO,
  CrmLeadProposalFormatDTO,
  CrmLeadProposalPresentationDTO,
  CrmLeadQualificationDTO,
  CrmLeadReopeningDTO,
} from '@/types/crm-lead'
import type { CrmPersonDTO } from '@/types/crm-person'
import { apiFetch } from './_fetch'

const base = (workspaceId: string, leadId: string) =>
  `/api/workspaces/${workspaceId}/crm/leads/${leadId}`

export function useRegisterCrmLeadContactAttempt(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      contactedWith: string
      channel: CrmLeadContactChannelDTO
      outcome: CrmLeadContactOutcomeDTO
      note?: string
    }) =>
      apiFetch<{ lead: CrmLeadDTO; attempt: CrmLeadContactAttemptDTO }>(
        `${base(workspaceId, input.leadId)}/contact-attempts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao registrar contato',
      ),
  })
}

export function useSetCrmLeadInterestProducts(workspaceId: string) {
  return useMutation({
    mutationFn: (input: { leadId: string; productIds: string[] }) =>
      apiFetch<CrmLeadDTO>(
        `${base(workspaceId, input.leadId)}/interest-products`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: input.productIds }),
        },
        'Erro ao salvar produtos de interesse',
      ),
  })
}

export function useUpsertCrmLeadQualification(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      expectedCloseAt?: string
      decisionMakerName: string
      decisionMakerRole: string
    }) =>
      apiFetch<{ lead: CrmLeadDTO; qualification: CrmLeadQualificationDTO }>(
        `${base(workspaceId, input.leadId)}/qualification`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao salvar qualificação',
      ),
  })
}

export function useRegisterCrmLeadMeeting(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      scheduledAt: string
      format: CrmLeadMeetingFormatDTO
      contactPersonName?: string
      interestDetails: string
      identifiedNeed: string
    }) =>
      apiFetch<{ lead: CrmLeadDTO; meeting: CrmLeadMeetingDTO }>(
        `${base(workspaceId, input.leadId)}/meetings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao registrar reunião',
      ),
  })
}

export function useCreateCrmLeadProposal(workspaceId: string) {
  return useMutation({
    mutationFn: (input: { leadId: string; name: string }) =>
      apiFetch<{ lead: CrmLeadDTO; proposal: CrmDocumentSummaryDTO }>(
        `${base(workspaceId, input.leadId)}/proposal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.name }),
        },
        'Erro ao criar proposta',
      ),
  })
}

export function useRegisterCrmLeadProposalPresentation(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      proposalId: string
      presentedAt: string
      format: CrmLeadProposalFormatDTO
      amount: number
      interestLevel: CrmLeadInterestLevelDTO
      interactionsCount: number
      notes?: string
    }) =>
      apiFetch<{
        lead: CrmLeadDTO
        presentation: CrmLeadProposalPresentationDTO
      }>(
        `${base(workspaceId, input.leadId)}/proposal/${input.proposalId}/presentations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao registrar apresentação da proposta',
      ),
  })
}

export function useCloseCrmLeadWon(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      contractSignedAt: string
      billingType: 'ONE_TIME' | 'MONTHLY' | 'YEARLY'
      closedAmount: number
      contractSignedConfirmed: true
    }) =>
      apiFetch<CrmPersonDTO>(
        `${base(workspaceId, input.leadId)}/close-won`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao fechar o lead como ganho',
      ),
  })
}

export function useCloseCrmLeadLost(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      leadId: string
      lostReason: string
      lostNote?: string
      retryAt?: string
    }) =>
      apiFetch<CrmLeadDTO>(
        `${base(workspaceId, input.leadId)}/close-lost`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao fechar o lead como perdido',
      ),
  })
}

const reopeningsKey = (workspaceId: string, leadId: string) =>
  ['crm-lead-reopenings', workspaceId, leadId] as const

/** Histórico de reaberturas do lead (mais recente primeiro). */
export function useCrmLeadReopenings(workspaceId: string, leadId: string) {
  return useQuery({
    queryKey: reopeningsKey(workspaceId, leadId),
    queryFn: () =>
      apiFetch<CrmLeadReopeningDTO[]>(
        `${base(workspaceId, leadId)}/reopenings`,
        undefined,
        'Erro ao carregar o histórico de reaberturas',
      ),
    enabled: !!workspaceId && !!leadId,
  })
}

export function useReopenCrmLead(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { leadId: string; reason: string }) =>
      apiFetch<CrmLeadDTO>(
        `${base(workspaceId, input.leadId)}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: input.reason }),
        },
        'Erro ao reabrir o lead',
      ),
    onSuccess: (_lead, input) => {
      queryClient.invalidateQueries({
        queryKey: reopeningsKey(workspaceId, input.leadId),
      })
    },
  })
}
