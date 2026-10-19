import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AiPiiMaskingPolicyDTO,
  WorkspaceAiGuardrailsDTO,
} from '@/types/ai-guardrails'
import { apiFetch } from './_fetch'

export const AI_GUARDRAILS_KEY = (workspaceId: string) =>
  ['ai-guardrails', workspaceId] as const

export interface UpdateAiGuardrailsInput {
  piiMaskingPolicy?: AiPiiMaskingPolicyDTO
  injectionClassifierEnabled?: boolean
  forbiddenTopics?: string[]
  maxDiscountPercent?: number | null
  maxRefundAmount?: number | null
  maxDeadlineDays?: number | null
}

export function useAiGuardrails(workspaceId: string) {
  return useQuery({
    queryKey: AI_GUARDRAILS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WorkspaceAiGuardrailsDTO>(
        `/api/workspaces/${workspaceId}/ai-guardrails`,
        undefined,
        'Erro ao buscar as proteções da IA',
      ),
    staleTime: 30 * 1000,
  })
}

export function useUpdateAiGuardrails(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateAiGuardrailsInput) =>
      apiFetch<WorkspaceAiGuardrailsDTO>(
        `/api/workspaces/${workspaceId}/ai-guardrails`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar as proteções da IA',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(AI_GUARDRAILS_KEY(workspaceId), data)
    },
  })
}
