'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from '@/lib/notify'
import type { DocumentActionResult } from '@/src/lib/canvas-document/context'
import type { DocumentExportDTO } from '@/types/document'
import type { SuccessResponse } from '@/types/http-response'
import { apiFetch, apiFetchJson } from './_fetch'

/** PDF export of CRM > Documentos (ADR 0063): owner button + public link. */

export const DOCUMENT_EXPORT_POLL_MS = 1500
/** Past this the UI gives up waiting (the worker keeps its own timeout). */
export const DOCUMENT_EXPORT_TIMEOUT_MS = 2 * 60 * 1000

export const EXPORT_FAILED_MESSAGE = 'Não foi possível gerar o PDF.'
export const EXPORT_SLOW_MESSAGE =
  'O PDF está demorando mais que o normal. Tente de novo em alguns minutos.'
export const EXPORT_READY_MESSAGE = 'PDF pronto. O download começou.'
const NETWORK_MESSAGE =
  'Sem conexão com o servidor. Verifique a internet e tente de novo.'

export const documentExportKey = (
  workspaceId: string,
  documentId: string,
  exportId: string | null,
) => ['document-export', workspaceId, documentId, exportId] as const

function exportsUrl(workspaceId: string, documentId: string): string {
  return `/api/workspaces/${workspaceId}/crm/documents/${documentId}/exports`
}

export function isDocumentExportInFlight(
  value: DocumentExportDTO | undefined,
): boolean {
  return value?.status === 'PENDING' || value?.status === 'RUNNING'
}

export function useCreateDocumentExport(
  workspaceId: string,
  documentId: string,
) {
  return useMutation({
    mutationFn: (input: { draft: boolean }) =>
      apiFetchJson<DocumentExportDTO>(
        exportsUrl(workspaceId, documentId),
        'POST',
        input,
        EXPORT_FAILED_MESSAGE,
      ),
  })
}

/** One export, polled while PENDING/RUNNING. */
export function useDocumentExport(
  workspaceId: string,
  documentId: string,
  exportId: string | null,
) {
  return useQuery({
    queryKey: documentExportKey(workspaceId, documentId, exportId),
    queryFn: () =>
      apiFetch<DocumentExportDTO>(
        `${exportsUrl(workspaceId, documentId)}/${exportId}`,
        undefined,
        'Não foi possível acompanhar a geração do PDF.',
      ),
    enabled: Boolean(workspaceId && documentId && exportId),
    refetchInterval: (query) =>
      isDocumentExportInFlight(query.state.data)
        ? DOCUMENT_EXPORT_POLL_MS
        : false,
  })
}

/** Starts a browser download of a same-origin or blob URL. */
export function downloadFile(url: string, fileName?: string): void {
  const link = document.createElement('a')
  link.href = url
  if (fileName) link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * "Exportar PDF": creates (or reuses) the export, polls it and downloads the
 * file when READY. Errors become pt-BR toasts.
 */
export function useDocumentPdfExport(workspaceId: string, documentId: string) {
  const queryClient = useQueryClient()
  const create = useCreateDocumentExport(workspaceId, documentId)
  const [exportId, setExportId] = useState<string | null>(null)
  const startedAt = useRef(0)
  const current = useDocumentExport(workspaceId, documentId, exportId)
  const { data, dataUpdatedAt, error } = current

  useEffect(() => {
    if (!exportId || !data || data.id !== exportId || !dataUpdatedAt) return
    if (data.status === 'READY' && data.downloadUrl) {
      downloadFile(data.downloadUrl)
      notify.success(EXPORT_READY_MESSAGE)
      setExportId(null)
    } else if (data.status === 'FAILED' || data.status === 'READY') {
      notify.error(data.error ?? EXPORT_FAILED_MESSAGE)
      setExportId(null)
    } else if (Date.now() - startedAt.current > DOCUMENT_EXPORT_TIMEOUT_MS) {
      notify.error(EXPORT_SLOW_MESSAGE)
      setExportId(null)
    }
    // `dataUpdatedAt` re-runs the checks on every poll, even when the
    // payload did not change (structural sharing keeps the same object).
  }, [exportId, data, dataUpdatedAt])

  useEffect(() => {
    if (!exportId || !error) return
    notify.error(error, EXPORT_FAILED_MESSAGE)
    setExportId(null)
  }, [exportId, error])

  const exportPdf = useCallback(
    async (input: { draft: boolean }) => {
      if (create.isPending || exportId) return
      try {
        const created = await create.mutateAsync(input)
        startedAt.current = Date.now()
        queryClient.setQueryData(
          documentExportKey(workspaceId, documentId, created.id),
          created,
        )
        setExportId(created.id)
      } catch (cause) {
        notify.error(cause, EXPORT_FAILED_MESSAGE)
      }
    },
    [create, exportId, queryClient, workspaceId, documentId],
  )

  return { exportPdf, isBusy: create.isPending || exportId !== null }
}

/** `attachment; filename="proposta.pdf"` → `proposta.pdf`. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null
  return match ? match[1] : null
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

type ErrorBody = { message?: string } | null

async function errorMessage(res: Response): Promise<string> {
  const body: ErrorBody = await res.json().catch(() => null)
  return body?.message ?? EXPORT_FAILED_MESSAGE
}

/**
 * PDF of the public link (`DocumentRuntime.downloadPdf`): asks
 * `GET /api/documents/<token>/pdf`, polls the export while it answers 202,
 * then downloads the file it finally streams.
 */
export async function requestPublicDocumentPdf(
  token: string,
  options: {
    pollMs?: number
    timeoutMs?: number
    wait?: (ms: number) => Promise<void>
  } = {},
): Promise<DocumentActionResult> {
  const pollMs = options.pollMs ?? DOCUMENT_EXPORT_POLL_MS
  const timeoutMs = options.timeoutMs ?? DOCUMENT_EXPORT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const wait = options.wait ?? sleep
  const base = `/api/documents/${encodeURIComponent(token)}/pdf`
  let url = base
  try {
    while (true) {
      const res = await fetch(url)
      if (!res.ok) return { ok: false, message: await errorMessage(res) }
      if (res.status === 202) {
        if (Date.now() > deadline) {
          return { ok: false, message: EXPORT_SLOW_MESSAGE }
        }
        const body: SuccessResponse<{ exportId: string }> = await res.json()
        url = `${base}?exportId=${encodeURIComponent(body.data.exportId)}`
        await wait(pollMs)
        continue
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const fileName = fileNameFromDisposition(
        res.headers.get('Content-Disposition'),
      )
      downloadFile(objectUrl, fileName ?? 'documento.pdf')
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
      return { ok: true }
    }
  } catch {
    return { ok: false, message: NETWORK_MESSAGE }
  }
}
