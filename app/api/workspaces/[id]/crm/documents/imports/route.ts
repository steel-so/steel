import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { documentImportUnsupported } from '@/src/errors/app-error'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { aiMessageLimiter, consume } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CreateDocumentImportSchema,
  DOCUMENT_IMPORT_MAX_BYTES,
} from '@/src/schemas/document.schema'
import {
  type DocumentImportFile,
  DocumentImportService,
} from '@/src/services/document-import.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Multipart overhead (boundary, fields) over the largest file accepted. */
const MAX_UPLOAD_BYTES = DOCUMENT_IMPORT_MAX_BYTES + 1024 * 1024

const text = (value: FormDataEntryValue | null) =>
  typeof value === 'string' && value.trim() ? value : undefined

/** PDF or DOCX by the file's name or type, when the form sends no mode. */
function modeOf(file: File): 'PDF' | 'DOCX' {
  if (/\.docx$/i.test(file.name)) return 'DOCX'
  if (file.type.includes('wordprocessingml')) return 'DOCX'
  return 'PDF'
}

interface ImportInput {
  body: unknown
  file?: DocumentImportFile
}

async function readInput(request: NextRequest): Promise<Result<ImportInput>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    const json = await readJsonBody(request)
    if (!json.ok) return json
    return ok({ body: json.value })
  }
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return err(documentImportUnsupported('Envie o arquivo no campo "file"'))
  }
  return ok({
    body: {
      mode: text(form.get('mode')) ?? modeOf(file),
      kind: text(form.get('kind')),
      title: text(form.get('title')),
    },
    file: {
      buffer: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      fileName: file.name,
    },
  })
}

/**
 * Starts an AI import (ADR 0063): multipart with `file` (PDF or DOCX up to
 * 20 MB / 60 pages) plus `mode`, `kind` and `title`, or JSON
 * `{ mode: 'PROMPT', prompt, kind, title }`. Answers 201 with the import;
 * the build runs in the worker (`documents-ai`) and is followed through
 * `GET .../imports/[importId]` or its `stream`.
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)
  const userId = auth.value.user.id

  const limit = await consume(aiMessageLimiter, `user:${userId}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    userId,
    'POST /api/workspaces/[id]/crm/documents/imports',
  )
  if (!consent.ok) return handleError(consent.error)

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_UPLOAD_BYTES) {
    return handleError(documentImportUnsupported('O arquivo passa de 20 MB'))
  }

  const input = await readInput(request)
  if (!input.ok) return handleError(input.error)
  const parsed = CreateDocumentImportSchema.safeParse(input.body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }
  // The storage key is always ours, never the client's.
  const { fileKey: _ignored, ...body } = parsed.data

  const { id } = await ctx.params
  const result = await DocumentImportService.create(
    userId,
    id,
    body,
    input.file,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
