'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  SdNlConfigApplyDTO,
  SdNlConfigPreviewDTO,
} from '@/src/schemas/sd-nl-config.schema'
import type {
  SdNlConfigApplyResultDTO,
  SdNlConfigPreviewResultDTO,
} from '@/types/sd-nl-config'
import { apiFetch } from './_fetch'
import { sdBase, sdJson } from './_sd-directory'
import { sdConfigKeys } from './use-sd-config'

/**
 * Configuração em linguagem natural (S8). `preview` não salva nada; só o
 * `apply`, chamado pelo botão "Aplicar", grava e atualiza as listas.
 */

export function useSdNlConfigPreview(workspaceId: string) {
  return useMutation({
    mutationFn: (dto: SdNlConfigPreviewDTO) =>
      apiFetch<SdNlConfigPreviewResultDTO>(
        sdBase(workspaceId, 'nl-config/preview'),
        sdJson('POST', dto),
        'Erro ao montar a configuração',
      ),
  })
}

export function useSdNlConfigApply(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: SdNlConfigApplyDTO) =>
      apiFetch<SdNlConfigApplyResultDTO>(
        sdBase(workspaceId, 'nl-config/apply'),
        sdJson('POST', dto),
        'Erro ao aplicar a configuração',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: sdConfigKeys.all(workspaceId),
      }),
  })
}
