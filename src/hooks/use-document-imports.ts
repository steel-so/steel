'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { readSteelAiStream } from '@/src/lib/steel-ai-stream'
import type { DocumentKindDTO } from '@/src/schemas/document.schema'
import type { DocumentImportDTO } from '@/types/document'
import type { DocumentImportContextDTO } from '@/types/document-import'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Client of the AI import of CRM > Documentos: the context (quota, model,
 * estimate), starting an import (file or prompt) and following it live —
 * the SSE stream feeds the query cache, and polling covers a dropped
 * stream. Errors surface as `ApiError` (pt-BR message + code).
 */

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/documents/imports`

export interface StartFileImportInput {
  mode: 'PDF' | 'DOCX'
  file: File
  kind: DocumentKindDTO
  title?: string
}

export interface StartPromptImportInput {
  mode: 'PROMPT'
  prompt: string
  kind: DocumentKindDTO
  title?: string
}

export type StartDocumentImportInput =
  | StartFileImportInput
  | StartPromptImportInput

export function documentImportsApi(workspaceId: string) {
  const root = base(workspaceId)
  return {
    context: () => apiFetch<DocumentImportContextDTO>(`${root}/context`),
    get: (importId: string) =>
      apiFetch<DocumentImportDTO>(`${root}/${importId}`),
    start: (input: StartDocumentImportInput) => {
      if (input.mode === 'PROMPT') {
        return apiFetchJson<DocumentImportDTO>(root, 'POST', input)
      }
      const form = new FormData()
      form.append('file', input.file)
      form.append('mode', input.mode)
      form.append('kind', input.kind)
      if (input.title) form.append('title', input.title)
      return apiFetch<DocumentImportDTO>(
        root,
        { method: 'POST', body: form },
        'Não foi possível enviar o arquivo',
      )
    },
  }
}

export const documentImportKeys = {
  context: (workspaceId: string) =>
    ['documents', workspaceId, 'imports', 'context'] as const,
  detail: (workspaceId: string, importId: string) =>
    ['documents', workspaceId, 'imports', importId] as const,
}

export function isDocumentImportFinished(
  dto: Pick<DocumentImportDTO, 'status'> | null | undefined,
): boolean {
  return dto?.status === 'READY' || dto?.status === 'FAILED'
}

/** Quota, model and estimates; refetched after every import. */
export function useDocumentImportContext(workspaceId: string, enabled = true) {
  return useQuery<DocumentImportContextDTO>({
    queryKey: documentImportKeys.context(workspaceId),
    queryFn: () => documentImportsApi(workspaceId).context(),
    enabled,
    staleTime: 30_000,
  })
}

export function useStartDocumentImport(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StartDocumentImportInput) =>
      documentImportsApi(workspaceId).start(input),
    onSuccess: (dto) => {
      queryClient.setQueryData(
        documentImportKeys.detail(workspaceId, dto.id),
        dto,
      )
    },
  })
}

type StreamFrame = DocumentImportDTO & { type?: string }

/** Polling interval while the stream is down or not supported. */
const POLL_MS = 4_000

/**
 * Follows one import until READY or FAILED: the stream pushes every step
 * into the cache; the query polls as a fallback.
 */
export function useDocumentImport(
  workspaceId: string,
  importId: string | null,
) {
  const queryClient = useQueryClient()
  const query = useQuery<DocumentImportDTO>({
    queryKey: documentImportKeys.detail(workspaceId, importId ?? ''),
    queryFn: () => documentImportsApi(workspaceId).get(importId ?? ''),
    enabled: Boolean(importId),
    refetchInterval: (current) =>
      isDocumentImportFinished(current.state.data) ? false : POLL_MS,
  })

  useEffect(() => {
    if (!importId) return
    const controller = new AbortController()
    const key = documentImportKeys.detail(workspaceId, importId)
    const follow = async () => {
      const res = await fetch(`${base(workspaceId)}/${importId}/stream`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) return
      await readSteelAiStream(res.body, (event) => {
        // The parser stamps the SSE event name as `type`; the DTO has none.
        const { type: _event, ...dto } = event as unknown as StreamFrame
        if (dto.id === importId) queryClient.setQueryData(key, dto)
      })
    }
    // A dropped stream is not an error: the query keeps polling.
    follow().catch(() => undefined)
    return () => controller.abort()
  }, [workspaceId, importId, queryClient])

  return query
}
