'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateAiInsightDTO } from '@/src/schemas/ai-insight.schema'
import type {
  AiDigestSettingsDTO,
  AiInsightDTO,
  AiInsightFeedDTO,
  AiInsightModuleDTO,
  AiInsightStateDTO,
} from '@/types/ai-insight'
import { apiFetch } from './_fetch'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/ai/insights`

export const AI_INSIGHTS_KEY = (workspaceId: string) =>
  ['ai-insights', workspaceId] as const

const DIGEST_KEY = (workspaceId: string) =>
  ['ai-digest-settings', workspaceId] as const

/** The worker recomputes every 15 min; a few minutes of staleness is fine. */
const STALE_MS = 2 * 60_000

export interface AiInsightFilters {
  state?: AiInsightStateDTO
  module?: AiInsightModuleDTO
  limit?: number
}

export function aiInsightsUrl(
  workspaceId: string,
  filters: AiInsightFilters = {},
): string {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.module) params.set('module', filters.module)
  if (filters.limit) params.set('limit', String(filters.limit))
  const query = params.toString()
  return query ? `${base(workspaceId)}?${query}` : base(workspaceId)
}

/** The current user's insights (home, Steel AI, inbox). */
export function useAiInsights(
  workspaceId: string,
  filters: AiInsightFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...AI_INSIGHTS_KEY(workspaceId), filters],
    queryFn: () =>
      apiFetch<AiInsightFeedDTO>(
        aiInsightsUrl(workspaceId, filters),
        undefined,
        'Erro ao carregar os alertas da IA',
      ),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
  })
}

/** Dismiss, snooze or restore; refreshes every feed of the workspace. */
export function useUpdateAiInsight(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...dto }: UpdateAiInsightDTO & { id: string }) =>
      apiFetch<AiInsightDTO>(
        `${base(workspaceId)}/${id}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(dto),
        },
        'Erro ao atualizar o alerta',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: AI_INSIGHTS_KEY(workspaceId) }),
  })
}

export function useAiDigestSettings(workspaceId: string) {
  return useQuery({
    queryKey: DIGEST_KEY(workspaceId),
    queryFn: () =>
      apiFetch<AiDigestSettingsDTO>(
        `/api/workspaces/${workspaceId}/ai/digest-settings`,
        undefined,
        'Erro ao carregar o resumo diário',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useUpdateAiDigestSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: { inApp?: boolean; email?: boolean }) =>
      apiFetch<AiDigestSettingsDTO>(
        `/api/workspaces/${workspaceId}/ai/digest-settings`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(dto) },
        'Erro ao salvar o resumo diário',
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(DIGEST_KEY(workspaceId), data),
  })
}
