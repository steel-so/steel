'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  AiFeedbackRatingKey,
  AiFeedbackReason,
  AiFeedbackSurfaceKey,
} from '@/src/lib/ai/quality-labels'
import type { AiFeedbackDTO, AiQualityDTO } from '@/types/ai-quality'
import { apiFetch, apiSend } from './_fetch'
import type { AiUsageFilter } from './use-ai-usage'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/ai/feedback`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const AI_FEEDBACK_KEY = (
  workspaceId: string,
  surface: AiFeedbackSurfaceKey,
  targetIds: string[],
) => ['ai-feedback', workspaceId, surface, targetIds] as const

export const AI_QUALITY_KEY = (workspaceId: string, filter: AiUsageFilter) =>
  ['ai-quality', workspaceId, filter] as const

export interface AiFeedbackInput {
  surface: AiFeedbackSurfaceKey
  targetId: string
  variant?: string
  rating: AiFeedbackRatingKey
  reason?: AiFeedbackReason | null
  comment?: string | null
}

/** Key of one rated answer inside a batch. */
export function feedbackKey(targetId: string, variant = ''): string {
  return `${targetId}|${variant}`
}

/**
 * The caller's own ratings of a batch of answers of one surface, keyed by
 * `feedbackKey(targetId, variant)`. Disabled while there is nothing to ask.
 */
export function useMyAiFeedback(
  workspaceId: string,
  surface: AiFeedbackSurfaceKey,
  targetIds: string[],
) {
  const ids = [...new Set(targetIds.filter(Boolean))].sort().slice(0, 100)
  return useQuery({
    queryKey: AI_FEEDBACK_KEY(workspaceId, surface, ids),
    queryFn: async () => {
      const params = new URLSearchParams({ surface, targetIds: ids.join(',') })
      const rows = await apiFetch<AiFeedbackDTO[]>(
        `${base(workspaceId)}?${params}`,
        undefined,
        'Erro ao carregar as avaliações',
      )
      return new Map(
        rows.map((row) => [feedbackKey(row.targetId, row.variant), row]),
      )
    },
    enabled: Boolean(workspaceId) && ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ai-feedback', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['ai-quality', workspaceId] }),
  ])
}

export function useRateAiAnswer(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AiFeedbackInput) =>
      apiFetch<AiFeedbackDTO>(
        base(workspaceId),
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
        'Não foi possível salvar a avaliação',
      ),
    onSuccess: () => invalidate(queryClient, workspaceId),
  })
}

export function useRemoveAiFeedback(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (feedbackId: string) =>
      apiSend(
        `${base(workspaceId)}/${encodeURIComponent(feedbackId)}`,
        { method: 'DELETE' },
        'Não foi possível desfazer a avaliação',
      ),
    onSuccess: () => invalidate(queryClient, workspaceId),
  })
}

function filterParams(filter: AiUsageFilter): URLSearchParams {
  const params = new URLSearchParams({
    scope: filter.scope,
    period: filter.period,
  })
  if (filter.period === 'custom') {
    if (filter.from) params.set('from', filter.from)
    if (filter.to) params.set('to', filter.to)
  }
  return params
}

/** Steel AI › Análises › Qualidade. */
export function useAiQuality(
  workspaceId: string,
  filter: AiUsageFilter,
  enabled = true,
) {
  return useQuery({
    queryKey: AI_QUALITY_KEY(workspaceId, filter),
    queryFn: () =>
      apiFetch<AiQualityDTO>(
        `/api/workspaces/${workspaceId}/ai/quality?${filterParams(filter)}`,
        undefined,
        'Erro ao carregar a qualidade da IA',
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })
}

export type AiQualityExportView = 'feedback' | 'surface' | 'model'

export function aiQualityExportUrl(
  workspaceId: string,
  filter: AiUsageFilter,
  view: AiQualityExportView,
): string {
  const params = filterParams(filter)
  params.set('view', view)
  return `/api/workspaces/${workspaceId}/ai/quality/export?${params}`
}
