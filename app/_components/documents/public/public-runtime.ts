'use client'

import { useMemo, useState } from 'react'
import { requestPublicDocumentPdf } from '@/src/hooks/use-document-exports'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type DocumentActionResult,
  type DocumentFieldInfo,
  type DocumentRuntime,
  type DocumentRuntimeStatus,
  documentFields,
} from '@/src/lib/canvas-document'
import type {
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
} from '@/src/schemas/document.schema'
import type { DocumentPublicDTO } from '@/types/document'

/** Public API of a link (`/api/documents/<token>`). */
export function publicDocumentUrl(token: string, path = ''): string {
  return `/api/documents/${encodeURIComponent(token)}${path}`
}

const STALE_MESSAGE =
  'O documento foi atualizado enquanto você lia. Recarregue a página para ver a versão nova.'
const NETWORK_MESSAGE = 'Sem conexão. Verifique a internet e tente de novo.'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Where the link starts: decided, expired by date, or open. */
export function initialRuntimeStatus(
  data: DocumentPublicDTO,
  now: number,
): DocumentRuntimeStatus {
  const { document, recipient } = data
  if (document.status === 'ACCEPTED' || recipient?.status === 'ACCEPTED') {
    return 'accepted'
  }
  if (document.status === 'DECLINED' || recipient?.status === 'DECLINED') {
    return 'declined'
  }
  if (document.status === 'EXPIRED') return 'expired'
  if (document.validUntil && new Date(document.validUntil).getTime() < now) {
    return 'expired'
  }
  return 'open'
}

function isEmpty(value: DocumentFieldValuesDTO[string] | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'boolean') return value === false
  return false
}

/** Required fields left blank and malformed e-mails, by field id. */
export function validateDocumentFields(
  fields: DocumentFieldInfo[],
  values: DocumentFieldValuesDTO,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.id]
    if (field.required && isEmpty(value)) {
      errors[field.id] = 'Preencha este campo'
      continue
    }
    if (
      field.type === 'field-email' &&
      typeof value === 'string' &&
      value.trim() &&
      !EMAIL.test(value.trim())
    ) {
      errors[field.id] = 'E-mail inválido'
    }
  }
  return errors
}

type ErrorBody = { message?: string; error?: { code?: string } } | null

async function readMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as ErrorBody
  if (body?.error?.code === 'DOCUMENT_VERSION_STALE') return STALE_MESSAGE
  return body?.message ?? fallback
}

async function post(
  url: string,
  body: unknown,
  fallback: string,
): Promise<DocumentActionResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    return { ok: false, message: await readMessage(res, fallback) }
  } catch {
    return { ok: false, message: NETWORK_MESSAGE }
  }
}

export interface PublicReader {
  name: string
  email: string
}

/**
 * `DocumentRuntime` of a public link: local field answers and pricing
 * selection, and the accept/decline/submit/download calls of the public
 * API. Field rules (required, e-mail) are checked before sending; the
 * server checks them again.
 */
export function usePublicDocumentRuntime({
  data,
  content,
  reader,
  now,
}: {
  data: DocumentPublicDTO
  content: CanvasDocument
  reader: PublicReader | null
  now: number
}): DocumentRuntime {
  const token = data.token
  const versionId = data.version.id
  const fields = useMemo(() => documentFields(content), [content])
  const [status, setStatus] = useState(() => initialRuntimeStatus(data, now))
  const [acceptedByName, setAcceptedByName] = useState(
    data.document.acceptedByName,
  )
  const [acceptedAt, setAcceptedAt] = useState(data.document.acceptedAt)
  const [fieldValues, setFieldValues] = useState<DocumentFieldValuesDTO>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [selection, setPicked] = useState<DocumentPricingSelectionDTO>({})

  return useMemo<DocumentRuntime>(() => {
    const check = (): DocumentActionResult => {
      const errors = validateDocumentFields(fields, fieldValues)
      setFieldErrors(errors)
      return Object.keys(errors).length > 0
        ? { ok: false, message: 'Preencha os campos destacados.' }
        : { ok: true }
    }

    return {
      versionId,
      status,
      acceptedByName,
      acceptedAt,
      canAccept: data.canAccept && status === 'open',
      canDownload: data.canDownload,
      fieldValues,
      fieldErrors,
      selection,
      setFieldValue: (fieldId, value) => {
        setFieldValues((current) => ({ ...current, [fieldId]: value }))
        setFieldErrors((current) => {
          if (!current[fieldId]) return current
          const { [fieldId]: _cleared, ...rest } = current
          return rest
        })
      },
      setSelection: (itemId, value) =>
        setPicked((current) => ({ ...current, [itemId]: value })),
      accept: async ({ name, email }) => {
        const valid = check()
        if (!valid.ok) return valid
        const result = await post(
          publicDocumentUrl(token, '/accept'),
          {
            name,
            email: email || reader?.email || undefined,
            agreed: true,
            fields: fieldValues,
            selection,
            versionId,
          },
          'Não foi possível registrar o aceite.',
        )
        if (result.ok) {
          setStatus('accepted')
          setAcceptedByName(name)
          setAcceptedAt(new Date().toISOString())
        }
        return result
      },
      decline: async ({ name, reason }) => {
        const result = await post(
          publicDocumentUrl(token, '/decline'),
          { name: name || reader?.name || undefined, reason, versionId },
          'Não foi possível registrar a recusa.',
        )
        if (result.ok) setStatus('declined')
        return result
      },
      submitFields: async () => {
        const valid = check()
        if (!valid.ok) return valid
        return post(
          publicDocumentUrl(token, '/submit'),
          {
            name: reader?.name || undefined,
            email: reader?.email || undefined,
            fields: fieldValues,
            selection,
            versionId,
          },
          'Não foi possível enviar as respostas.',
        )
      },
      downloadPdf: () => requestPublicDocumentPdf(token),
    }
  }, [
    data,
    fields,
    token,
    reader,
    versionId,
    status,
    acceptedByName,
    acceptedAt,
    fieldValues,
    fieldErrors,
    selection,
  ])
}
