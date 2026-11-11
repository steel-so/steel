import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/axiom/logger'
import { withAxiom } from '@/lib/axiom/server'
import { streamDocumentPdf } from '@/src/lib/document-export/stream'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { DocumentExportService } from '@/src/services/document-export.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

const QuerySchema = z.object({
  exportId: z.string().trim().min(1).max(64).optional(),
})

/**
 * PDF of the public link (no session). The first call queues the render of
 * the current version and answers 202 `{ status, exportId }`; the client
 * polls with `?exportId=` until the answer is the file itself
 * (`Content-Disposition: attachment`). Off when the document disables
 * downloads. Rate limited by hashed IP (LGPD: the raw IP is never kept).
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = getClientIp(request)
  const ipHash = createHash('sha256').update(ip).digest('hex')
  const limit = await consume(apiLimiter, `document-pdf:${ipHash}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const parsed = QuerySchema.safeParse({
    exportId: request.nextUrl.searchParams.get('exportId') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await DocumentExportService.requestPublicPdf(
    token,
    parsed.data.exportId ?? null,
  )
  if (!result.ok) return handleError(result.error)

  if (result.value.kind === 'pending') {
    return successResponse(
      { status: result.value.status, exportId: result.value.exportId },
      202,
    )
  }

  try {
    return await streamDocumentPdf(result.value.file)
  } catch (error) {
    logger.error('document_export.public_download_failed', {
      component: 'DocumentExport',
      exportId: result.value.exportId,
      message: error instanceof Error ? error.message : String(error),
    })
    return standardError('STORAGE_ERROR', 'Arquivo do PDF indisponível')
  }
})
