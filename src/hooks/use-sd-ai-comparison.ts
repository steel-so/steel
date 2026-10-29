import { useQuery } from '@tanstack/react-query'
import type { SdAiComparisonDTO } from '@/types/sd-ai-comparison'
import { apiFetch } from './_fetch'

/**
 * Painel "IA vs. técnico" do ServiceDesk
 * (`.../servicedesk/ai/comparison`): leitura única, já agregada pelo servidor.
 */

export type SdAiComparisonDays = 7 | 30 | 90

export const sdAiComparisonKeys = {
  all: (ws: string) => ['sd-ai-comparison', ws] as const,
  period: (ws: string, days: SdAiComparisonDays) =>
    ['sd-ai-comparison', ws, days] as const,
}

export function useSdAiComparison(
  workspaceId: string,
  days: SdAiComparisonDays,
) {
  return useQuery({
    queryKey: sdAiComparisonKeys.period(workspaceId, days),
    queryFn: () =>
      apiFetch<SdAiComparisonDTO>(
        `/api/workspaces/${workspaceId}/servicedesk/ai/comparison?days=${days}`,
        undefined,
        'Erro ao carregar o comparativo da IA',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}
