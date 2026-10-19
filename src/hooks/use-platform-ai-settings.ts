'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PlatformAiSettingsDTO } from '@/types/platform-ai-settings'
import { apiFetch } from './_fetch'

export const platformAiSettingsKey = ['admin', 'platform-ai-settings'] as const

/**
 * Global admin: saves the platform AI cost margin and the knowledge search
 * embeddings switch (ADR 0037; absent = keep the saved value).
 */
export function useUpdatePlatformAiSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: {
      costMargin: number
      embeddingsEnabled?: boolean
      /** Default model per task class (ADR 0042); null = platform default. */
      taskModels?: Partial<
        Record<
          'CLASSIFICATION' | 'CONVERSATION' | 'ASSISTANT' | 'AGENT',
          string | null
        >
      >
      failoverEnabled?: boolean
      reason?: string
    }) =>
      apiFetch<PlatformAiSettingsDTO>(
        '/api/admin/ai',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(variables),
        },
        'Erro ao salvar os ajustes de IA',
      ),
    onSuccess: (settings) => {
      queryClient.setQueryData(platformAiSettingsKey, settings)
    },
  })
}
