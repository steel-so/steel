'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './_fetch'

/** One pipeline with its stages in order, for the deals kanban columns. */
export interface CrmPipelineStages {
  id: string
  name: string
  isDefault: boolean
  stages: { id: string; name: string; category: 'OPEN' | 'WON' | 'LOST' }[]
}

type RawPipeline = { id: string; name: string; isDefault: boolean }
type RawStage = {
  id: string
  name: string
  position: number
  category: 'OPEN' | 'WON' | 'LOST'
}

/** Pipelines with their stages sorted by position (default pipeline first). */
export function useCrmPipelineStages(workspaceId: string) {
  return useQuery({
    queryKey: ['crm-pipeline-stages', workspaceId],
    queryFn: async (): Promise<CrmPipelineStages[]> => {
      const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/crm/pipelines`
      const pipelines = await apiFetch<RawPipeline[]>(
        base,
        undefined,
        'Erro ao buscar os funis',
      )
      const withStages = await Promise.all(
        pipelines.map(async (pipeline) => {
          const stages = await apiFetch<RawStage[]>(
            `${base}/${pipeline.id}/stages`,
            undefined,
            'Erro ao buscar as etapas',
          )
          return {
            id: pipeline.id,
            name: pipeline.name,
            isDefault: pipeline.isDefault,
            stages: [...stages]
              .sort((a, b) => a.position - b.position)
              .map(({ id, name, category }) => ({ id, name, category })),
          }
        }),
      )
      return withStages.sort(
        (a, b) => Number(b.isDefault) - Number(a.isDefault),
      )
    },
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
}
